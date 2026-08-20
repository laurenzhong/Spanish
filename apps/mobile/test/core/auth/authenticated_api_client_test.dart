import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:spanish_mobile/core/auth/auth_session.dart';
import 'package:spanish_mobile/core/auth/authenticated_api_client.dart';
import 'package:spanish_mobile/core/auth/token_coordinator.dart';

class _SessionSource implements AuthSessionSource {
  _SessionSource(this.session);

  AuthSessionSnapshot session;
  int refreshCount = 0;
  final eventController = StreamController<AuthSessionEvent>.broadcast();

  @override
  AuthSessionSnapshot get currentSession => session;

  @override
  Stream<AuthSessionEvent> get events => eventController.stream;

  @override
  Stream<AuthSessionSnapshot?> get sessions => const Stream.empty();

  @override
  Future<void> refreshSession() async {
    refreshCount++;
    session = AuthSessionSnapshot(
      userId: session.userId,
      accessToken: 'fresh-token',
      expiresAt: DateTime.utc(2099),
    );
    eventController.add(AuthSessionEvent.tokenRefreshed);
  }

  Future<void> close() => eventController.close();
}

class _RecordedRequest {
  const _RecordedRequest({
    required this.method,
    required this.headers,
    required this.body,
  });

  final String method;
  final Map<String, String> headers;
  final String body;
}

class _RecordingClient extends http.BaseClient {
  _RecordingClient(this.statuses);

  final List<int> statuses;
  final requests = <_RecordedRequest>[];

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final concrete = request as http.Request;
    requests.add(
      _RecordedRequest(
        method: concrete.method,
        headers: Map<String, String>.from(concrete.headers),
        body: concrete.body,
      ),
    );
    final status = statuses[requests.length - 1];
    return http.StreamedResponse(
      Stream.value(utf8.encode('{"ok":true}')),
      status,
      headers: {'content-type': 'application/json'},
    );
  }
}

void main() {
  late _SessionSource source;
  late AccessTokenCoordinator coordinator;

  setUp(() {
    source = _SessionSource(
      AuthSessionSnapshot(
        userId: 'user-a',
        accessToken: 'current-token',
        expiresAt: DateTime.utc(2099),
      ),
    );
    coordinator = AccessTokenCoordinator(source);
  });

  tearDown(() async {
    await coordinator.dispose();
    await source.close();
  });

  test('adds the verified bearer token to requests', () async {
    final transport = _RecordingClient([200]);
    final client = AuthenticatedApiClient(
      coordinator,
      baseUri: Uri.parse('https://api.example.test/api/v1/'),
      client: transport,
    );

    final response = await client.get('auth/session');

    expect(response.statusCode, 200);
    expect(
      transport.requests.single.headers['authorization'],
      'Bearer current-token',
    );
  });

  test('does not retry a 401 unless the caller explicitly opts in', () async {
    final transport = _RecordingClient([401]);
    final client = AuthenticatedApiClient(
      coordinator,
      baseUri: Uri.parse('https://api.example.test/api/v1/'),
      client: transport,
    );

    expect((await client.get('auth/session')).statusCode, 401);
    expect(transport.requests, hasLength(1));
    expect(source.refreshCount, 0);
  });

  test('refreshes and retries an opted-in safe request only once', () async {
    final transport = _RecordingClient([401, 200]);
    final client = AuthenticatedApiClient(
      coordinator,
      baseUri: Uri.parse('https://api.example.test/api/v1/'),
      client: transport,
    );

    final response = await client.get(
      'auth/session',
      retryAfterUnauthorized: true,
    );

    expect(response.statusCode, 200);
    expect(transport.requests, hasLength(2));
    expect(source.refreshCount, 1);
    expect(
      transport.requests.map((request) => request.headers['authorization']),
      ['Bearer current-token', 'Bearer fresh-token'],
    );
  });

  test('requires and preserves an idempotency key for POST retries', () async {
    final transport = _RecordingClient([401, 200]);
    final client = AuthenticatedApiClient(
      coordinator,
      baseUri: Uri.parse('https://api.example.test/api/v1/'),
      client: transport,
    );

    expect(
      () => client.postJson(
        'events',
        body: {'kind': 'practice'},
        retryAfterUnauthorized: true,
      ),
      throwsArgumentError,
    );

    final response = await client.postJson(
      'events',
      body: {'kind': 'practice'},
      idempotencyKey: 'attempt-1',
      retryAfterUnauthorized: true,
    );

    expect(response.statusCode, 200);
    expect(transport.requests, hasLength(2));
    expect(
      transport.requests.map((request) => request.headers['idempotency-key']),
      ['attempt-1', 'attempt-1'],
    );
    expect(
      transport.requests.every((request) => request.method == 'POST'),
      isTrue,
    );
    expect(
      transport.requests.every((request) => request.body.contains('practice')),
      isTrue,
    );
  });
}
