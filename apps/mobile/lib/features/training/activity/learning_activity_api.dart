import 'package:spanish_mobile/core/auth/authenticated_api_client.dart';

import 'learning_activity_recorder.dart';

LearningActivityEventSender createLearningActivityApiSender({
  required AuthenticatedApiClient client,
  required String sessionId,
}) {
  return (event) async {
    final response = await client.postJson(
      '/api/v1/practice/sessions/$sessionId/activity',
      body: event.toJson(),
      idempotencyKey: '${event.clientInstanceId}:${event.sequence}',
      retryAfterUnauthorized: true,
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError('learning-activity-request-failed');
    }
  };
}
