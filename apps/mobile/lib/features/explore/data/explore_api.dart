import 'dart:convert';

import 'package:spanish_mobile/core/auth/authenticated_api_client.dart';

class ExploreApi {
  ExploreApi(this._client);

  final AuthenticatedApiClient _client;

  Future<ExploreDashboardSnapshot?> fetchDashboard() async {
    final response = await _client.get('/api/v1/explore/dashboard');
    if (response.statusCode < 200 || response.statusCode >= 300) return null;
    final decoded = jsonDecode(response.body);
    if (decoded is! Map<String, dynamic>) return null;
    final data = decoded['data'];
    if (data is! Map<String, dynamic>) return null;
    final packs = <ExplorePackSnapshot>[];
    final rawPacks = data['packs'];
    if (rawPacks is List) {
      for (final raw in rawPacks) {
        if (raw is! Map<String, dynamic>) continue;
        packs.add(ExplorePackSnapshot(
          stableKey: raw['stableKey'] as String? ?? '',
          version: int.tryParse((raw['version'] as String? ?? 'v1').replaceFirst('v', '')) ?? 1,
          saved: raw['saved'] as bool? ?? false,
        ));
      }
    }
    return ExploreDashboardSnapshot(packs: packs);
  }

  Future<bool> savePack({
    required String stableKey,
    required int version,
    required int totalSteps,
    required int completedSteps,
    required bool saved,
  }) async {
    final response = await _client.postJson(
      '/api/v1/explore/state',
      body: {
        'stableKey': stableKey,
        'version': version,
        'totalSteps': totalSteps,
        'completedSteps': completedSteps,
        'saved': saved,
      },
    );
    return response.statusCode >= 200 && response.statusCode < 300;
  }
}

class ExploreDashboardSnapshot {
  const ExploreDashboardSnapshot({required this.packs});

  final List<ExplorePackSnapshot> packs;
}

class ExplorePackSnapshot {
  const ExplorePackSnapshot({required this.stableKey, required this.version, required this.saved});

  final String stableKey;
  final int version;
  final bool saved;
}
