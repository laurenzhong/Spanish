import 'training_event.dart';
import 'training_state.dart';

TrainingTransition _reject(
  TrainingState state,
  TrainingEvent event,
  String reason,
) => TrainingTransition(
      state: state,
      effects: <TrainingEffect>[
        TrainingEffect('reject-event', <String, Object?>{
          'eventType': event.type,
          'reason': reason,
        }),
      ],
    );

TrainingTransition _stale(TrainingState state, TrainingEvent event) =>
    TrainingTransition(
      state: state,
      effects: <TrainingEffect>[
        TrainingEffect('ignore-stale-result', <String, Object?>{
          'eventType': event.type,
          'generationId': event.integer('generationId'),
          'currentGenerationId': state.generationId,
        }),
      ],
    );

TrainingTransition _technicalError(
  TrainingState state,
  String code,
  TrainingStatus recoverTo,
) => TrainingTransition(
      state: state.copyWith(
        status: TrainingStatus.recoverableError,
        error: TrainingError(code: code, recoverTo: recoverTo),
      ),
      effects: <TrainingEffect>[
        TrainingEffect('show-error', <String, Object?>{
          'code': code,
          'technical': true,
        }),
        const TrainingEffect('save-breakpoint'),
      ],
    );

TrainingTransition transition(
  TrainingState state,
  TrainingEvent event,
) {
  if (event.type == 'exit') {
    return TrainingTransition(
      state: state,
      effects: state.status == TrainingStatus.completed
          ? <TrainingEffect>[const TrainingEffect('exit-training')]
          : <TrainingEffect>[
              const TrainingEffect('save-breakpoint'),
              const TrainingEffect('exit-training'),
            ],
    );
  }

  switch (state.status) {
    case TrainingStatus.loadingContext:
      if (event.type != 'content-loaded') {
        return _reject(state, event, 'Content must load before this event.');
      }
      return TrainingTransition(
        state: state.copyWith(
          status: TrainingStatus.presentingInput,
          contentKey: event.string('contentKey'),
          goalKey: event.string('goalKey'),
          generationId: state.generationId + 1,
          clearError: true,
        ),
        effects: <TrainingEffect>[const TrainingEffect('play-input')],
      );
    case TrainingStatus.presentingInput:
      if (event.type == 'input-playback-completed') {
        return TrainingTransition(
          state: state.copyWith(status: TrainingStatus.awaitingOutput),
          effects: const <TrainingEffect>[],
        );
      }
      if (event.type == 'input-playback-failed') {
        return _technicalError(
          state,
          event.string('errorCode'),
          TrainingStatus.presentingInput,
        );
      }
      if (event.type == 'request-hint' && event.integer('level') > state.hintLevel) {
        return TrainingTransition(
          state: state.copyWith(hintLevel: event.integer('level')),
          effects: <TrainingEffect>[const TrainingEffect('save-breakpoint')],
        );
      }
      return _reject(state, event, 'Input is still being presented.');
    case TrainingStatus.awaitingOutput:
      if (event.type == 'start-recording') {
        final generationId = state.generationId + 1;
        return TrainingTransition(
          state: state.copyWith(
            status: TrainingStatus.recording,
            outputMode: TrainingOutputMode.speech,
            generationId: generationId,
            clearTranscript: true,
            clearEvaluation: true,
            clearError: true,
          ),
          effects: <TrainingEffect>[
            TrainingEffect('start-recording', <String, Object?>{
              'generationId': generationId,
            }),
          ],
        );
      }
      if (event.type == 'submit-typing') {
        final text = event.string('text').trim();
        if (text.isEmpty) return _reject(state, event, 'Typed output cannot be empty.');
        final generationId = state.generationId + 1;
        return TrainingTransition(
          state: state.copyWith(
            status: TrainingStatus.evaluating,
            outputMode: TrainingOutputMode.typing,
            generationId: generationId,
            transcript: text,
            clearEvaluation: true,
            clearError: true,
          ),
          effects: <TrainingEffect>[
            TrainingEffect('evaluate', <String, Object?>{
              'generationId': generationId,
              'outputMode': TrainingOutputMode.typing.value,
            }),
          ],
        );
      }
      if (event.type == 'request-hint' && event.integer('level') > state.hintLevel) {
        return TrainingTransition(
          state: state.copyWith(hintLevel: event.integer('level')),
          effects: <TrainingEffect>[const TrainingEffect('save-breakpoint')],
        );
      }
      if (event.type == 'switch-to-silent') {
        return TrainingTransition(
          state: state.copyWith(outputMode: TrainingOutputMode.typing),
          effects: <TrainingEffect>[const TrainingEffect('save-breakpoint')],
        );
      }
      return _reject(state, event, 'The learner is choosing an output.');
    case TrainingStatus.recording:
      if (event.type == 'stop-recording') {
        if (event.integer('generationId') != state.generationId) return _stale(state, event);
        return TrainingTransition(
          state: state.copyWith(status: TrainingStatus.transcribing, clearError: true),
          effects: <TrainingEffect>[
            TrainingEffect('stop-recording', <String, Object?>{
              'generationId': state.generationId,
            }),
            TrainingEffect('transcribe', <String, Object?>{
              'generationId': state.generationId,
            }),
          ],
        );
      }
      if (event.type == 'cancel-recording') {
        if (event.integer('generationId') != state.generationId) return _stale(state, event);
        return TrainingTransition(
          state: state.copyWith(status: TrainingStatus.awaitingOutput, clearError: true),
          effects: <TrainingEffect>[
            TrainingEffect('stop-recording', <String, Object?>{
              'generationId': state.generationId,
            }),
            const TrainingEffect('save-breakpoint'),
          ],
        );
      }
      return _reject(state, event, 'Recording must be stopped or cancelled.');
    case TrainingStatus.transcribing:
      if (event.type == 'transcription-succeeded') {
        if (event.integer('generationId') != state.generationId) return _stale(state, event);
        final confidence = event.number('confidence');
        final transcript = event.string('transcript').trim();
        if (confidence < 0 || confidence > 1) {
          return _technicalError(state, 'invalid-transcript-confidence', TrainingStatus.awaitingOutput);
        }
        if (transcript.isEmpty) {
          return _technicalError(state, 'empty-transcript', TrainingStatus.awaitingOutput);
        }
        return TrainingTransition(
          state: state.copyWith(status: TrainingStatus.evaluating, transcript: transcript, clearError: true),
          effects: <TrainingEffect>[
            TrainingEffect('evaluate', <String, Object?>{
              'generationId': state.generationId,
              'outputMode': TrainingOutputMode.speech.value,
            }),
          ],
        );
      }
      if (event.type == 'transcription-failed') {
        if (event.integer('generationId') != state.generationId) return _stale(state, event);
        return _technicalError(state, event.string('errorCode'), TrainingStatus.awaitingOutput);
      }
      return _reject(state, event, 'A transcription result is required.');
    case TrainingStatus.evaluating:
      if (event.type == 'evaluation-succeeded') {
        if (event.integer('generationId') != state.generationId) return _stale(state, event);
        return TrainingTransition(
          state: state.copyWith(
            status: TrainingStatus.showingFeedback,
            evaluation: TrainingEvaluation(
              contextualSuccess: event.boolean('contextualSuccess'),
              evidenceStrength: EvidenceStrength.fromValue(event.string('evidenceStrength')),
              feedbackKey: event.string('feedbackKey'),
            ),
            clearError: true,
          ),
          effects: <TrainingEffect>[
            const TrainingEffect('show-feedback'),
            const TrainingEffect('save-breakpoint'),
          ],
        );
      }
      if (event.type == 'evaluation-failed') {
        if (event.integer('generationId') != state.generationId) return _stale(state, event);
        return _technicalError(state, event.string('errorCode'), TrainingStatus.awaitingOutput);
      }
      return _reject(state, event, 'An evaluation result is required.');
    case TrainingStatus.showingFeedback:
      if (event.type == 'enter-variant') {
        return TrainingTransition(
          state: state.copyWith(status: TrainingStatus.transitioning, clearError: true),
          effects: <TrainingEffect>[const TrainingEffect('prepare-variant')],
        );
      }
      if (event.type == 'continue' || event.type == 'complete-task') {
        return TrainingTransition(
          state: state.copyWith(
            status: event.type == 'complete-task'
                ? TrainingStatus.completed
                : TrainingStatus.transitioning,
          ),
          effects: <TrainingEffect>[const TrainingEffect('save-breakpoint')],
        );
      }
      return _reject(state, event, 'Feedback must be continued or completed.');
    case TrainingStatus.transitioning:
      if (event.type == 'variant-ready') {
        return TrainingTransition(
          state: state.copyWith(
            status: TrainingStatus.presentingInput,
            generationId: state.generationId + 1,
            hintLevel: 0,
            clearTranscript: true,
            clearEvaluation: true,
            clearError: true,
          ),
          effects: <TrainingEffect>[const TrainingEffect('play-input')],
        );
      }
      return _reject(state, event, 'The next task is not ready.');
    case TrainingStatus.recoverableError:
      if (event.type == 'retry') {
        final recoveryStatus = state.error?.recoverTo ?? TrainingStatus.awaitingOutput;
        return TrainingTransition(
          state: state.copyWith(
            status: recoveryStatus,
            generationId: state.generationId + 1,
            clearError: true,
          ),
          effects: recoveryStatus == TrainingStatus.presentingInput
              ? <TrainingEffect>[const TrainingEffect('play-input')]
              : <TrainingEffect>[const TrainingEffect('save-breakpoint')],
        );
      }
      return _reject(state, event, 'Retry or exit is required after a technical failure.');
    case TrainingStatus.completed:
      return _reject(state, event, 'This task is already completed.');
  }
}

TrainingTransition reduceTraining(
  List<TrainingEvent> events, {
  TrainingState? initialState,
}) {
  var result = TrainingTransition(
    state: initialState ?? TrainingState.initial(),
    effects: <TrainingEffect>[],
  );
  for (final event in events) {
    result = transition(result.state, event);
  }
  return result;
}
