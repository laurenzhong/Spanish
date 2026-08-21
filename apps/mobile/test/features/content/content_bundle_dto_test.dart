import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:spanish_mobile/features/content/data/content_bundle_dto.dart';

void main() {
  final repositoryRoot = Directory.current.parent.parent;
  final fixturesDirectory = Directory(
    '${repositoryRoot.path}/contracts/fixtures/content/v1',
  );

  dynamic readJson(String fileName) => jsonDecode(
    File('${fixturesDirectory.path}/$fileName').readAsStringSync(),
  );

  dynamic applyOperations(Object? input, List<dynamic> operations) {
    final output = jsonDecode(jsonEncode(input));
    for (final rawOperation in operations) {
      final operation = rawOperation as Map<String, dynamic>;
      final path = operation['path'] as List<dynamic>;
      dynamic parent = output;
      for (final segment in path.take(path.length - 1)) {
        parent = segment is int
            ? (parent as List<dynamic>)[segment]
            : (parent as Map<String, dynamic>)[segment as String];
      }
      final last = path.last;
      if (last is int) {
        (parent as List<dynamic>)[last] = operation['value'];
      } else {
        (parent as Map<String, dynamic>)[last as String] = operation['value'];
      }
    }
    return output;
  }

  test('parses the complete shared content bundle into strict DTOs', () {
    final bundle = ContentBundleDto.fromJson(
      readJson('content-bundle-valid.json'),
    );

    expect(bundle.schemaVersion, '1.0');
    expect(bundle.bundle.stableKey, 'alpha.contract-fixture');
    expect(bundle.domains.single.stableKey, 'communication.start');
    expect(bundle.expressions.single.text, 'Hola, ¿qué tal?');
    expect(
      bundle.expressions.single.tags.where((tag) => tag.scoring).length,
      2,
    );
    expect(bundle.scenarios.single.tasks.single.targetExpressionKeys, [
      'greet.hola-que-tal',
    ]);
    expect(
      bundle.contentPacks.single.sources.single.copyrightStatus,
      'cleared',
    );
    expect(bundle.characters.single.displayName, 'Lucía Martín');
  });

  test('matches every shared semantic fixture outcome', () {
    final manifest = readJson('manifest.json') as Map<String, dynamic>;
    final base = readJson(manifest['baseFixture'] as String);

    expect(manifest['schemaVersion'], '1.0');
    for (final rawCase in manifest['cases'] as List<dynamic>) {
      final fixtureCase = rawCase as Map<String, dynamic>;
      final input = applyOperations(
        base,
        fixtureCase['operations'] as List<dynamic>,
      );
      if (fixtureCase['valid'] as bool) {
        expect(
          () => ContentBundleDto.fromJson(input),
          returnsNormally,
          reason: fixtureCase['name'] as String,
        );
      } else {
        expect(
          () => ContentBundleDto.fromJson(input),
          throwsA(isA<ContentBundleFormatException>()),
          reason: fixtureCase['name'] as String,
        );
      }
    }
  });

  test('rejects unknown fields instead of silently ignoring drift', () {
    final input = readJson('content-bundle-valid.json') as Map<String, dynamic>;
    input['unexpected'] = true;

    expect(
      () => ContentBundleDto.fromJson(input),
      throwsA(isA<ContentBundleFormatException>()),
    );
  });
}
