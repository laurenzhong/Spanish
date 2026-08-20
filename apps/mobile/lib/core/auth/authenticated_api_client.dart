import 'dart:convert';

import 'package:http/http.dart' as http;

import 'token_coordinator.dart';

class AuthenticatedApiClient {
  AuthenticatedApiClient(
    this._tokenCoordinator, {
    required this.baseUri,
    http.Client? client,
  }) : _client = client ?? http.Client();

  final Uri baseUri;
  final AccessTokenCoordinator _tokenCoordinator;
  final http.Client _client;

  Future<http.Response> get(
    String path, {
    bool retryAfterUnauthorized = false,
  }) {
    return _send('GET', path, retryAfterUnauthorized: retryAfterUnauthorized);
  }

  Future<http.Response> postJson(
    String path, {
    required Object body,
    String? idempotencyKey,
    bool retryAfterUnauthorized = false,
  }) {
    if (retryAfterUnauthorized && idempotencyKey == null) {
      throw ArgumentError(
        'POST authentication retries require an idempotency key.',
      );
    }
    return _send(
      'POST',
      path,
      body: jsonEncode(body),
      idempotencyKey: idempotencyKey,
      retryAfterUnauthorized: retryAfterUnauthorized,
    );
  }

  Future<http.Response> _send(
    String method,
    String path, {
    String? body,
    String? idempotencyKey,
    required bool retryAfterUnauthorized,
  }) async {
    final response = await _sendOnce(
      method,
      path,
      body: body,
      idempotencyKey: idempotencyKey,
      forceRefresh: false,
    );
    if (response.statusCode != 401 || !retryAfterUnauthorized) {
      return response;
    }

    return _sendOnce(
      method,
      path,
      body: body,
      idempotencyKey: idempotencyKey,
      forceRefresh: true,
    );
  }

  Future<http.Response> _sendOnce(
    String method,
    String path, {
    String? body,
    String? idempotencyKey,
    required bool forceRefresh,
  }) async {
    final token = await _tokenCoordinator.requireValidAccessToken(
      forceRefresh: forceRefresh,
    );
    final request = http.Request(method, baseUri.resolve(path));
    request.headers['authorization'] = 'Bearer $token';
    request.headers['accept'] = 'application/json';
    if (body != null) {
      request.headers['content-type'] = 'application/json';
      request.body = body;
    }
    if (idempotencyKey != null) {
      request.headers['idempotency-key'] = idempotencyKey;
    }

    final streamed = await _client.send(request);
    return http.Response.fromStream(streamed);
  }

  void close() => _client.close();
}
