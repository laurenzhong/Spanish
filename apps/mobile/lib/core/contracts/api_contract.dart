const apiVersion = 'v1';

enum ApiErrorCode {
  validationFailed('VALIDATION_FAILED', false),
  authRequired('AUTH_REQUIRED', false),
  forbidden('FORBIDDEN', false),
  resourceNotFound('RESOURCE_NOT_FOUND', false),
  conflict('CONFLICT', false),
  rateLimited('RATE_LIMITED', true),
  protocolVersionUnsupported('PROTOCOL_VERSION_UNSUPPORTED', false),
  providerTimeout('PROVIDER_TIMEOUT', true),
  providerUnavailable('PROVIDER_UNAVAILABLE', true),
  internalError('INTERNAL_ERROR', true);

  const ApiErrorCode(this.wireName, this.defaultRetryable);

  final String wireName;
  final bool defaultRetryable;

  static ApiErrorCode fromWireName(String value) {
    for (final code in values) {
      if (code.wireName == value) {
        return code;
      }
    }
    throw ContractFormatException(
      ApiErrorCode.validationFailed,
      'Unknown API error code: $value',
    );
  }
}

const apiErrorCodes = ApiErrorCode.values;

class ApiError {
  const ApiError({
    required this.code,
    required this.message,
    required this.retryable,
    this.requestId,
    this.details,
  });

  factory ApiError.fromJson(Object? input) {
    final json = _requireMap(
      input,
      'Error response must include an error object.',
    );
    _requireAllowedKeys(json, const <String>{
      'code',
      'message',
      'retryable',
      'requestId',
      'details',
    });
    final rawCode = json['code'];
    final message = json['message'];
    final retryable = json['retryable'];
    final requestId = json['requestId'];
    final details = json['details'];

    if (rawCode is! String) {
      throw ContractFormatException(
        ApiErrorCode.validationFailed,
        'Error response must include a string error code.',
      );
    }
    if (message is! String || message.isEmpty || message.length > 500) {
      throw ContractFormatException(
        ApiErrorCode.validationFailed,
        'Error response must include a message.',
      );
    }
    if (retryable is! bool) {
      throw ContractFormatException(
        ApiErrorCode.validationFailed,
        'Error response must include retryable as a boolean.',
      );
    }
    if (requestId != null && requestId is! String) {
      throw ContractFormatException(
        ApiErrorCode.validationFailed,
        'requestId must be a string.',
      );
    }
    if (requestId is String &&
        !RegExp(r'^[A-Za-z0-9_-]{8,128}$').hasMatch(requestId)) {
      throw ContractFormatException(
        ApiErrorCode.validationFailed,
        'requestId has an invalid format.',
      );
    }
    if (details != null && details is! Map) {
      throw ContractFormatException(
        ApiErrorCode.validationFailed,
        'details must be an object.',
      );
    }

    return ApiError(
      code: ApiErrorCode.fromWireName(rawCode),
      message: message,
      retryable: retryable,
      requestId: requestId as String?,
      details: details == null
          ? null
          : Map<String, Object?>.from(details as Map),
    );
  }

  final ApiErrorCode code;
  final String message;
  final bool retryable;
  final String? requestId;
  final Map<String, Object?>? details;
}

class ErrorResponse {
  const ErrorResponse({required this.version, required this.error});

  factory ErrorResponse.fromJson(Object? input) {
    final json = _requireMap(input, 'Response must be an object.');
    _requireAllowedKeys(json, const <String>{'apiVersion', 'error'});
    _requireSupportedVersion(json['apiVersion']);
    return ErrorResponse(
      version: apiVersion,
      error: ApiError.fromJson(json['error']),
    );
  }

  final String version;
  final ApiError error;
}

class PageInfo {
  const PageInfo({required this.nextCursor, required this.hasMore});

  factory PageInfo.fromJson(Object? input) {
    final json = _requireMap(input, 'page must be an object.');
    _requireAllowedKeys(json, const <String>{'nextCursor', 'hasMore'});
    final nextCursor = json['nextCursor'];
    final hasMore = json['hasMore'];

    if (nextCursor != null &&
        (nextCursor is! String ||
            nextCursor.isEmpty ||
            nextCursor.length > 512)) {
      throw ContractFormatException(
        ApiErrorCode.validationFailed,
        'nextCursor must be a string or null.',
      );
    }
    if (hasMore is! bool) {
      throw ContractFormatException(
        ApiErrorCode.validationFailed,
        'hasMore must be a boolean.',
      );
    }

    return PageInfo(nextCursor: nextCursor as String?, hasMore: hasMore);
  }

  final String? nextCursor;
  final bool hasMore;
}

class SuccessResponse {
  const SuccessResponse({required this.version, required this.data, this.page});

  factory SuccessResponse.fromJson(Object? input) {
    final json = _requireMap(input, 'Response must be an object.');
    _requireAllowedKeys(json, const <String>{'apiVersion', 'data', 'page'});
    _requireSupportedVersion(json['apiVersion']);
    if (!json.containsKey('data')) {
      throw ContractFormatException(
        ApiErrorCode.validationFailed,
        'Success response must include data.',
      );
    }

    return SuccessResponse(
      version: apiVersion,
      data: json['data'],
      page: json['page'] == null ? null : PageInfo.fromJson(json['page']),
    );
  }

  final String version;
  final Object? data;
  final PageInfo? page;
}

class AuthSessionIdentity {
  const AuthSessionIdentity({required this.userId, required this.email});

  factory AuthSessionIdentity.fromResponse(Object? input) {
    final response = SuccessResponse.fromJson(input);
    final data = _requireMap(
      response.data,
      'Auth session response must include a data object.',
    );
    _requireAllowedKeys(data, const <String>{'userId', 'email'});
    final userId = data['userId'];
    final email = data['email'];
    final uuid = RegExp(
      r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
      caseSensitive: false,
    );

    if (userId is! String || !uuid.hasMatch(userId)) {
      throw ContractFormatException(
        ApiErrorCode.validationFailed,
        'Auth session userId must be a UUID.',
      );
    }
    if (email != null && email is! String) {
      throw ContractFormatException(
        ApiErrorCode.validationFailed,
        'Auth session email must be a string or null.',
      );
    }

    return AuthSessionIdentity(userId: userId, email: email as String?);
  }

  final String userId;
  final String? email;
}

class AccountProfileAvatar {
  const AccountProfileAvatar({required this.kind, required this.presetId, required this.url, required this.initials, required this.colorIndex});

  final String kind;
  final String? presetId;
  final String? url;
  final String initials;
  final int colorIndex;
}

class AccountProfileDto {
  const AccountProfileDto({required this.publicUid, required this.displayName, required this.nativeLanguage, required this.interfaceLanguage, required this.targetLanguage, required this.updatedAt, required this.avatar});

  factory AccountProfileDto.fromResponse(Object? input) {
    final response = SuccessResponse.fromJson(input);
    final data = _requireMap(response.data, 'Account profile response must include a data object.');
    _requireAllowedKeys(data, const <String>{'publicUid', 'displayName', 'nativeLanguage', 'interfaceLanguage', 'targetLanguage', 'updatedAt', 'avatar'});
    final uid = data['publicUid'];
    if (uid is! String || !RegExp(r'^SN-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$').hasMatch(uid)) throw ContractFormatException(ApiErrorCode.validationFailed, 'Account profile publicUid is invalid.');
    final avatar = _requireMap(data['avatar'], 'Account profile avatar is required.');
    _requireAllowedKeys(avatar, const <String>{'kind', 'presetId', 'url', 'initials', 'colorIndex'});
    final kind = avatar['kind'];
    if (kind is! String || !const <String>{'upload', 'preset', 'initials'}.contains(kind)) throw ContractFormatException(ApiErrorCode.validationFailed, 'Account profile avatar kind is invalid.');
    if (data['displayName'] != null && data['displayName'] is! String) throw ContractFormatException(ApiErrorCode.validationFailed, 'Account profile displayName is invalid.');
    if (data['nativeLanguage'] is! String || data['interfaceLanguage'] is! String || data['targetLanguage'] is! String || data['updatedAt'] is! String || avatar['initials'] is! String || avatar['colorIndex'] is! int) throw ContractFormatException(ApiErrorCode.validationFailed, 'Account profile contains invalid fields.');
    return AccountProfileDto(publicUid: uid, displayName: data['displayName'] as String?, nativeLanguage: data['nativeLanguage'] as String, interfaceLanguage: data['interfaceLanguage'] as String, targetLanguage: data['targetLanguage'] as String, updatedAt: data['updatedAt'] as String, avatar: AccountProfileAvatar(kind: kind, presetId: avatar['presetId'] as String?, url: avatar['url'] as String?, initials: avatar['initials'] as String, colorIndex: avatar['colorIndex'] as int));
  }

  final String publicUid;
  final String? displayName;
  final String nativeLanguage;
  final String interfaceLanguage;
  final String targetLanguage;
  final String updatedAt;
  final AccountProfileAvatar avatar;
}

class ContractFormatException extends FormatException {
  ContractFormatException(this.code, super.message);

  final ApiErrorCode code;
}

Map<String, Object?> _requireMap(Object? input, String message) {
  if (input is! Map) {
    throw ContractFormatException(ApiErrorCode.validationFailed, message);
  }
  try {
    return Map<String, Object?>.from(input);
  } on TypeError {
    throw ContractFormatException(ApiErrorCode.validationFailed, message);
  }
}

void _requireSupportedVersion(Object? version) {
  if (version != apiVersion) {
    throw ContractFormatException(
      ApiErrorCode.protocolVersionUnsupported,
      'Unsupported API version: $version',
    );
  }
}

void _requireAllowedKeys(Map<String, Object?> input, Set<String> allowedKeys) {
  if (input.keys.any((key) => !allowedKeys.contains(key))) {
    throw ContractFormatException(
      ApiErrorCode.validationFailed,
      'Response contains an unsupported field.',
    );
  }
}
