import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:spanish_mobile/core/contracts/api_contract.dart';

void main() {
  final repositoryRoot = Directory.current.parent.parent;
  final fixturesDirectory = Directory(
    '${repositoryRoot.path}/contracts/fixtures/v1',
  );
  final registryDirectory = Directory(
    '${repositoryRoot.path}/contracts/registry/v1',
  );

  dynamic readJson(File file) => jsonDecode(file.readAsStringSync());

  test('keeps protocol and error registry aligned with Dart', () {
    final protocol = readJson(
      File('${registryDirectory.path}/protocol.json'),
    ) as Map<String, dynamic>;
    final registry = readJson(
      File('${registryDirectory.path}/error-codes.json'),
    ) as List<dynamic>;

    expect(protocol['apiVersion'], apiVersion);
    expect(
      registry.map((entry) => (entry as Map<String, dynamic>)['code']),
      apiErrorCodes.map((code) => code.wireName),
    );

    for (final rawEntry in registry) {
      final entry = rawEntry as Map<String, dynamic>;
      final code = ApiErrorCode.fromWireName(entry['code'] as String);
      expect(code.defaultRetryable, entry['defaultRetryable']);
    }
  });

  test('parses and rejects the same shared fixtures as TypeScript', () {
    final manifest = readJson(
      File('${fixturesDirectory.path}/manifest.json'),
    ) as Map<String, dynamic>;

    expect(manifest['apiVersion'], apiVersion);

    for (final rawCase in manifest['cases'] as List<dynamic>) {
      final fixtureCase = rawCase as Map<String, dynamic>;
      final fixture = readJson(
        File('${fixturesDirectory.path}/${fixtureCase['file']}'),
      );

      if (fixtureCase['valid'] as bool) {
        if (fixtureCase['kind'] == 'error') {
          final response = ErrorResponse.fromJson(fixture);
          final expected = fixtureCase['expected'] as Map<String, dynamic>;
          expect(response.error.code.wireName, expected['code']);
          expect(response.error.retryable, expected['retryable']);
        } else {
          expect(SuccessResponse.fromJson(fixture).version, apiVersion);
        }
      } else {
        Object? parseFixture() => fixtureCase['kind'] == 'error'
            ? ErrorResponse.fromJson(fixture)
            : SuccessResponse.fromJson(fixture);
        expect(
          parseFixture,
          throwsA(
            isA<ContractFormatException>().having(
              (error) => error.code.wireName,
              'code',
              fixtureCase['expectedParseError'],
            ),
          ),
        );
      }
    }
  });
}
