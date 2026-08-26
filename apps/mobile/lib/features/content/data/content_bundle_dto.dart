typedef LocalizedText = Map<String, String>;
typedef JsonObject = Map<String, Object?>;

class ContentBundleFormatException extends FormatException {
  ContentBundleFormatException(super.message);
}

class ContentBundleDto {
  ContentBundleDto._({
    required this.schemaVersion,
    required this.bundle,
    required this.domains,
    required this.goals,
    required this.tags,
    required this.expressions,
    required this.scenarios,
    required this.contentPacks,
    required this.characters,
    required this.articles,
    required this.reviews,
  });

  factory ContentBundleDto.fromJson(Object? input) {
    final json = _object(input, 'content bundle', const {
      'schemaVersion',
      'bundle',
      'domains',
      'goals',
      'tags',
      'expressions',
      'scenarios',
      'contentPacks',
      'characters',
      'articles',
      'reviews',
    });
    final schemaVersion = _string(json['schemaVersion'], 'schemaVersion');
    if (schemaVersion != '1.0') {
      throw ContentBundleFormatException(
        'Unsupported content schema version: $schemaVersion',
      );
    }
    final result = ContentBundleDto._(
      schemaVersion: schemaVersion,
      bundle: ContentBundleMetadataDto.fromJson(json['bundle']),
      domains: _typedList(
        json['domains'],
        'domains',
        ContentDomainDto.fromJson,
      ),
      goals: _typedList(json['goals'], 'goals', ContentGoalDto.fromJson),
      tags: _typedList(json['tags'], 'tags', ContentTagDto.fromJson),
      expressions: _typedList(
        json['expressions'],
        'expressions',
        ContentExpressionDto.fromJson,
      ),
      scenarios: _typedList(
        json['scenarios'],
        'scenarios',
        ContentScenarioDto.fromJson,
      ),
      contentPacks: _typedList(
        json['contentPacks'],
        'contentPacks',
        ContentPackDto.fromJson,
      ),
      characters: _typedList(
        json['characters'],
        'characters',
        ContentCharacterDto.fromJson,
      ),
      articles: _typedList(json['articles'], 'articles', ArticleDto.fromJson),
      reviews: _typedList(
        json['reviews'],
        'reviews',
        ContentReviewDto.fromJson,
      ),
    );
    result._validateSemantics();
    return result;
  }

  final String schemaVersion;
  final ContentBundleMetadataDto bundle;
  final List<ContentDomainDto> domains;
  final List<ContentGoalDto> goals;
  final List<ContentTagDto> tags;
  final List<ContentExpressionDto> expressions;
  final List<ContentScenarioDto> scenarios;
  final List<ContentPackDto> contentPacks;
  final List<ContentCharacterDto> characters;
  final List<ArticleDto> articles;
  final List<ContentReviewDto> reviews;

  void _validateSemantics() {
    if (domains.isEmpty ||
        goals.isEmpty ||
        tags.isEmpty ||
        expressions.isEmpty) {
      throw ContentBundleFormatException(
        'Content bundles require domains, goals, tags, and expressions.',
      );
    }
    _requireUnique(domains.map((item) => item.stableKey), 'domain');
    _requireUnique(goals.map((item) => item.stableKey), 'goal');
    _requireUnique(tags.map((item) => item.stableKey), 'tag');
    _requireUnique(
      expressions.map((item) => _versioned(item.stableKey, item.version)),
      'expression',
    );
    _requireUnique(
      scenarios.map((item) => _versioned(item.stableKey, item.version)),
      'scenario',
    );
    _requireUnique(
      contentPacks.map((item) => _versioned(item.stableKey, item.version)),
      'content pack',
    );
    _requireUnique(
      characters.map((item) => _versioned(item.stableKey, item.version)),
      'character',
    );
    _requireUnique(
      articles.map((item) => _versioned(item.stableKey, item.version)),
      'article',
    );

    final domainKeys = domains.map((item) => item.stableKey).toSet();
    final goalKeys = goals.map((item) => item.stableKey).toSet();
    final tagKeys = tags.map((item) => item.stableKey).toSet();
    final expressionKeys = expressions.map((item) => item.stableKey).toSet();

    for (final goal in goals) {
      if (!domainKeys.contains(goal.domainKey)) {
        throw ContentBundleFormatException(
          'Unknown domainKey: ${goal.domainKey}',
        );
      }
      if (_cefrOrder.indexOf(goal.cefrMin) > _cefrOrder.indexOf(goal.cefrMax)) {
        throw ContentBundleFormatException(
          'cefrMin cannot be higher than cefrMax for ${goal.stableKey}.',
        );
      }
    }

    for (final expression in expressions) {
      if (expression.chunks.isEmpty || expression.tags.isEmpty) {
        throw ContentBundleFormatException(
          'Expression ${expression.stableKey} requires chunks and tags.',
        );
      }
      if (!goalKeys.contains(expression.goalKey)) {
        throw ContentBundleFormatException(
          'Unknown goalKey: ${expression.goalKey}',
        );
      }
      _requireUnique(
        expression.variants.map((item) => item.position.toString()),
        'expression variant position',
      );
      _requireUnique(
        expression.tags.map((item) => item.tagKey),
        'expression tag',
      );
      for (final tag in expression.tags) {
        if (!tagKeys.contains(tag.tagKey)) {
          throw ContentBundleFormatException('Unknown tagKey: ${tag.tagKey}');
        }
      }
      final scoringWeight = expression.tags
          .where((item) => item.scoring)
          .fold<double>(0, (sum, item) => sum + item.weight);
      if ((scoringWeight - 1).abs() > 0.000001) {
        throw ContentBundleFormatException(
          'Scoring tag weights must sum to 1 for ${expression.stableKey}.',
        );
      }
      if (expression.status == 'published') {
        if (expression.publishedAt == null) {
          throw ContentBundleFormatException(
            'Published expression ${expression.stableKey} requires publishedAt.',
          );
        }
        if (!expression.translations.containsKey(bundle.nativeLanguage)) {
          throw ContentBundleFormatException(
            'Published expression ${expression.stableKey} requires a ${bundle.nativeLanguage} translation.',
          );
        }
      }
    }

    for (final scenario in scenarios) {
      if (scenario.tasks.isEmpty) {
        throw ContentBundleFormatException(
          'Scenario ${scenario.stableKey} requires at least one task.',
        );
      }
      _requireUnique(
        scenario.tasks.map((item) => item.position.toString()),
        'scenario task position',
      );
      for (final task in scenario.tasks) {
        if (!goalKeys.contains(task.goalKey)) {
          throw ContentBundleFormatException(
            'Unknown goalKey: ${task.goalKey}',
          );
        }
        for (final key in task.targetExpressionKeys) {
          if (!expressionKeys.contains(key)) {
            throw ContentBundleFormatException(
              'Unknown target expression: $key',
            );
          }
        }
      }
    }

    for (final pack in contentPacks) {
      if (pack.segments.isEmpty ||
          pack.activities.isEmpty ||
          pack.sources.isEmpty) {
        throw ContentBundleFormatException(
          'Content pack ${pack.stableKey} requires segments, activities, and sources.',
        );
      }
      _requireUnique(
        pack.segments.map((item) => item.position.toString()),
        'content segment position',
      );
      _requireUnique(
        pack.activities.map((item) => item.position.toString()),
        'content activity position',
      );
      final segmentPositions = pack.segments
          .map((item) => item.position)
          .toSet();
      for (final activity in pack.activities) {
        final segmentPosition = activity.segmentPosition;
        if (segmentPosition != null &&
            !segmentPositions.contains(segmentPosition)) {
          throw ContentBundleFormatException(
            'Unknown segment position: $segmentPosition',
          );
        }
      }
      for (final source in pack.sources) {
        if (source.license != 'original' &&
            (source.sourceUrl == null ||
                source.attribution == null ||
                source.licenseEvidence == null)) {
          throw ContentBundleFormatException(
            'Non-original sources require URL, attribution, and license evidence.',
          );
        }
        if (pack.status == 'published' && source.copyrightStatus != 'cleared') {
          throw ContentBundleFormatException(
            'Published content requires cleared copyright status.',
          );
        }
      }
      if (pack.status == 'published' && pack.publishedAt == null) {
        throw ContentBundleFormatException(
          'Published content pack ${pack.stableKey} requires publishedAt.',
        );
      }
    }

    for (final character in characters) {
      _requireUnique(
        character.canonFacts.map(
          (item) => _versioned(item.factKey, item.version),
        ),
        'character canon fact',
      );
    }

    final knownEntities = <String>{
      ...domains.map(
        (item) => _reviewKey('communication_domain', item.stableKey, null),
      ),
      ...goals.map((item) => _reviewKey('learning_goal', item.stableKey, null)),
      ...expressions.map(
        (item) => _reviewKey('expression', item.stableKey, item.version),
      ),
      ...scenarios.map(
        (item) => _reviewKey('scenario', item.stableKey, item.version),
      ),
      ...contentPacks.map(
        (item) => _reviewKey('content_pack', item.stableKey, item.version),
      ),
      ...characters.map(
        (item) => _reviewKey('character', item.stableKey, item.version),
      ),
    };
    final approved = <String>{};
    for (final review in reviews) {
      final expectsVersion = _versionedReviewTypes.contains(review.entityType);
      if (expectsVersion != (review.version != null)) {
        throw ContentBundleFormatException(
          'Review version does not match entity type ${review.entityType}.',
        );
      }
      final key = _reviewKey(
        review.entityType,
        review.stableKey,
        review.version,
      );
      if (!knownEntities.contains(key)) {
        throw ContentBundleFormatException(
          'Review references an unknown entity: $key',
        );
      }
      if (review.status == 'approved') {
        if (review.reviewerReference == null || review.reviewedAt == null) {
          throw ContentBundleFormatException(
            'Approved reviews require reviewerReference and reviewedAt.',
          );
        }
        approved.add(key);
      }
    }

    final published = <String>{
      ...domains
          .where((item) => item.status == 'published')
          .map(
            (item) => _reviewKey('communication_domain', item.stableKey, null),
          ),
      ...goals
          .where((item) => item.status == 'published')
          .map((item) => _reviewKey('learning_goal', item.stableKey, null)),
      ...expressions
          .where((item) => item.status == 'published')
          .map(
            (item) => _reviewKey('expression', item.stableKey, item.version),
          ),
      ...scenarios
          .where((item) => item.status == 'published')
          .map((item) => _reviewKey('scenario', item.stableKey, item.version)),
      ...contentPacks
          .where((item) => item.status == 'published')
          .map(
            (item) => _reviewKey('content_pack', item.stableKey, item.version),
          ),
      ...characters
          .where((item) => item.status == 'published')
          .map((item) => _reviewKey('character', item.stableKey, item.version)),
    };
    for (final key in published) {
      if (!approved.contains(key)) {
        throw ContentBundleFormatException(
          'Published entity requires an approved review: $key',
        );
      }
    }
  }
}

class ContentBundleMetadataDto {
  const ContentBundleMetadataDto({
    required this.stableKey,
    required this.version,
    required this.defaultLocale,
    required this.nativeLanguage,
    required this.description,
  });

  factory ContentBundleMetadataDto.fromJson(Object? input) {
    final json = _object(input, 'bundle metadata', const {
      'stableKey',
      'version',
      'defaultLocale',
      'nativeLanguage',
      'description',
    });
    return ContentBundleMetadataDto(
      stableKey: _stableKey(json['stableKey'], 'bundle.stableKey'),
      version: _positiveInt(json['version'], 'bundle.version'),
      defaultLocale: _locale(json['defaultLocale'], 'bundle.defaultLocale'),
      nativeLanguage: _locale(json['nativeLanguage'], 'bundle.nativeLanguage'),
      description: _string(json['description'], 'bundle.description'),
    );
  }

  final String stableKey;
  final int version;
  final String defaultLocale;
  final String nativeLanguage;
  final String description;
}

class ContentDomainDto {
  const ContentDomainDto({
    required this.stableKey,
    required this.title,
    required this.description,
    required this.position,
    required this.status,
  });

  factory ContentDomainDto.fromJson(Object? input) {
    final json = _object(input, 'domain', const {
      'stableKey',
      'title',
      'description',
      'position',
      'status',
    });
    return ContentDomainDto(
      stableKey: _stableKey(json['stableKey'], 'domain.stableKey'),
      title: _localized(json['title'], 'domain.title'),
      description: _localized(json['description'], 'domain.description'),
      position: _position(json['position'], 'domain.position'),
      status: _enum(json['status'], 'domain.status', _contentStatuses),
    );
  }

  final String stableKey;
  final LocalizedText title;
  final LocalizedText description;
  final int position;
  final String status;
}

class ContentGoalDto {
  const ContentGoalDto({
    required this.stableKey,
    required this.domainKey,
    required this.title,
    required this.description,
    required this.cefrMin,
    required this.cefrMax,
    required this.position,
    required this.status,
  });

  factory ContentGoalDto.fromJson(Object? input) {
    final json = _object(input, 'goal', const {
      'stableKey',
      'domainKey',
      'title',
      'description',
      'cefrMin',
      'cefrMax',
      'position',
      'status',
    });
    return ContentGoalDto(
      stableKey: _stableKey(json['stableKey'], 'goal.stableKey'),
      domainKey: _stableKey(json['domainKey'], 'goal.domainKey'),
      title: _localized(json['title'], 'goal.title'),
      description: _localized(json['description'], 'goal.description'),
      cefrMin: _enum(json['cefrMin'], 'goal.cefrMin', _cefrOrder.toSet()),
      cefrMax: _enum(json['cefrMax'], 'goal.cefrMax', _cefrOrder.toSet()),
      position: _position(json['position'], 'goal.position'),
      status: _enum(json['status'], 'goal.status', _contentStatuses),
    );
  }

  final String stableKey;
  final String domainKey;
  final LocalizedText title;
  final LocalizedText description;
  final String cefrMin;
  final String cefrMax;
  final int position;
  final String status;
}

class ContentTagDto {
  const ContentTagDto({
    required this.stableKey,
    required this.category,
    required this.label,
    required this.description,
    required this.isActive,
  });

  factory ContentTagDto.fromJson(Object? input) {
    final json = _object(input, 'tag', const {
      'stableKey',
      'category',
      'label',
      'description',
      'isActive',
    });
    return ContentTagDto(
      stableKey: _stableKey(json['stableKey'], 'tag.stableKey'),
      category: _enum(json['category'], 'tag.category', _tagCategories),
      label: _localized(json['label'], 'tag.label'),
      description: _localized(json['description'], 'tag.description'),
      isActive: _bool(json['isActive'], 'tag.isActive'),
    );
  }

  final String stableKey;
  final String category;
  final LocalizedText label;
  final LocalizedText description;
  final bool isActive;
}

class ContentChunkDto {
  const ContentChunkDto({
    required this.text,
    required this.kind,
    required this.stressed,
  });

  factory ContentChunkDto.fromJson(Object? input) {
    final json = _object(input, 'chunk', const {'text', 'kind', 'stressed'});
    return ContentChunkDto(
      text: _string(json['text'], 'chunk.text'),
      kind: _enum(json['kind'], 'chunk.kind', _chunkKinds),
      stressed: _bool(json['stressed'], 'chunk.stressed'),
    );
  }

  final String text;
  final String kind;
  final bool stressed;
}

class ContentSlotDto {
  const ContentSlotDto({
    required this.key,
    required this.description,
    required this.examples,
  });

  factory ContentSlotDto.fromJson(Object? input) {
    final json = _object(input, 'slot', const {
      'key',
      'description',
      'examples',
    });
    final examples = _stringList(json['examples'], 'slot.examples');
    if (examples.length < 2) {
      throw ContentBundleFormatException('slot.examples requires two values.');
    }
    return ContentSlotDto(
      key: _stableKey(json['key'], 'slot.key'),
      description: _localized(json['description'], 'slot.description'),
      examples: examples,
    );
  }

  final String key;
  final LocalizedText description;
  final List<String> examples;
}

class TeachingNoteDto {
  const TeachingNoteDto({required this.summary, required this.details});

  factory TeachingNoteDto.fromJson(Object? input) {
    final json = _object(input, 'teaching note', const {'summary', 'details'});
    return TeachingNoteDto(
      summary: _localized(json['summary'], 'teachingNote.summary'),
      details: _localized(json['details'], 'teachingNote.details'),
    );
  }

  final LocalizedText summary;
  final LocalizedText details;
}

class ExpressionUsageDto {
  const ExpressionUsageDto({
    required this.summary,
    required this.avoidWhen,
    required this.relationshipTypes,
    required this.toneEffects,
  });

  factory ExpressionUsageDto.fromJson(Object? input) {
    final json = _object(input, 'expression usage', const {
      'summary',
      'avoidWhen',
      'relationshipTypes',
      'toneEffects',
    });
    return ExpressionUsageDto(
      summary: _localized(json['summary'], 'usage.summary'),
      avoidWhen: _localized(json['avoidWhen'], 'usage.avoidWhen'),
      relationshipTypes: _stableKeyList(
        json['relationshipTypes'],
        'usage.relationshipTypes',
      ),
      toneEffects: _stringList(json['toneEffects'], 'usage.toneEffects'),
    );
  }

  final LocalizedText summary;
  final LocalizedText avoidWhen;
  final List<String> relationshipTypes;
  final List<String> toneEffects;
}

class ExpressionVariantDto {
  const ExpressionVariantDto({
    required this.text,
    required this.usageNotes,
    required this.region,
    required this.register,
    required this.position,
    required this.status,
  });

  factory ExpressionVariantDto.fromJson(Object? input) {
    final json = _object(input, 'expression variant', const {
      'text',
      'usageNotes',
      'region',
      'register',
      'position',
      'status',
    });
    return ExpressionVariantDto(
      text: _string(json['text'], 'variant.text'),
      usageNotes: _localized(json['usageNotes'], 'variant.usageNotes'),
      region: _string(json['region'], 'variant.region'),
      register: _string(json['register'], 'variant.register'),
      position: _position(json['position'], 'variant.position'),
      status: _enum(json['status'], 'variant.status', _contentStatuses),
    );
  }

  final String text;
  final LocalizedText usageNotes;
  final String region;
  final String register;
  final int position;
  final String status;
}

class ExpressionTagDto {
  const ExpressionTagDto({
    required this.tagKey,
    required this.weight,
    required this.scoring,
  });

  factory ExpressionTagDto.fromJson(Object? input) {
    final json = _object(input, 'expression tag', const {
      'tagKey',
      'weight',
      'scoring',
    });
    final weight = _number(json['weight'], 'expressionTag.weight');
    if (weight <= 0 || weight > 1) {
      throw ContentBundleFormatException(
        'expressionTag.weight must be greater than 0 and at most 1.',
      );
    }
    return ExpressionTagDto(
      tagKey: _stableKey(json['tagKey'], 'expressionTag.tagKey'),
      weight: weight,
      scoring: _bool(json['scoring'], 'expressionTag.scoring'),
    );
  }

  final String tagKey;
  final double weight;
  final bool scoring;
}

class ContentExpressionDto {
  const ContentExpressionDto({
    required this.stableKey,
    required this.version,
    required this.goalKey,
    required this.locale,
    required this.text,
    required this.translations,
    required this.communicativeIntent,
    required this.chunks,
    required this.targetChunks,
    required this.slots,
    required this.grammar,
    required this.pronunciation,
    required this.usage,
    required this.cefr,
    required this.register,
    required this.region,
    required this.frequency,
    required this.status,
    required this.publishedAt,
    required this.variants,
    required this.tags,
  });

  factory ContentExpressionDto.fromJson(Object? input) {
    final json = _object(input, 'expression', const {
      'stableKey',
      'version',
      'goalKey',
      'locale',
      'text',
      'translations',
      'communicativeIntent',
      'chunks',
      'targetChunks',
      'slots',
      'grammar',
      'pronunciation',
      'usage',
      'cefr',
      'register',
      'region',
      'frequency',
      'status',
      'publishedAt',
      'variants',
      'tags',
    });
    final variants = _typedList(
      json['variants'],
      'expression.variants',
      ExpressionVariantDto.fromJson,
    );
    if (variants.length < 2) {
      throw ContentBundleFormatException(
        'expression.variants requires at least two values.',
      );
    }
    return ContentExpressionDto(
      stableKey: _stableKey(json['stableKey'], 'expression.stableKey'),
      version: _positiveInt(json['version'], 'expression.version'),
      goalKey: _stableKey(json['goalKey'], 'expression.goalKey'),
      locale: _locale(json['locale'], 'expression.locale'),
      text: _string(json['text'], 'expression.text'),
      translations: _localized(json['translations'], 'expression.translations'),
      communicativeIntent: _localized(
        json['communicativeIntent'],
        'expression.communicativeIntent',
      ),
      chunks: _typedList(
        json['chunks'],
        'expression.chunks',
        ContentChunkDto.fromJson,
      ),
      targetChunks: _stringList(
        json['targetChunks'],
        'expression.targetChunks',
      ),
      slots: _typedList(
        json['slots'],
        'expression.slots',
        ContentSlotDto.fromJson,
      ),
      grammar: TeachingNoteDto.fromJson(json['grammar']),
      pronunciation: TeachingNoteDto.fromJson(json['pronunciation']),
      usage: ExpressionUsageDto.fromJson(json['usage']),
      cefr: _enum(json['cefr'], 'expression.cefr', _cefrOrder.toSet()),
      register: _string(json['register'], 'expression.register'),
      region: _string(json['region'], 'expression.region'),
      frequency: _enum(json['frequency'], 'expression.frequency', _frequencies),
      status: _enum(json['status'], 'expression.status', _contentStatuses),
      publishedAt: _optionalDate(json['publishedAt'], 'expression.publishedAt'),
      variants: variants,
      tags: _typedList(
        json['tags'],
        'expression.tags',
        ExpressionTagDto.fromJson,
      ),
    );
  }

  final String stableKey;
  final int version;
  final String goalKey;
  final String locale;
  final String text;
  final LocalizedText translations;
  final LocalizedText communicativeIntent;
  final List<ContentChunkDto> chunks;
  final List<String> targetChunks;
  final List<ContentSlotDto> slots;
  final TeachingNoteDto grammar;
  final TeachingNoteDto pronunciation;
  final ExpressionUsageDto usage;
  final String cefr;
  final String register;
  final String region;
  final String frequency;
  final String status;
  final DateTime? publishedAt;
  final List<ExpressionVariantDto> variants;
  final List<ExpressionTagDto> tags;
}

class PromptSetDto {
  const PromptSetDto({
    required this.level1,
    required this.level2,
    required this.level3,
  });

  factory PromptSetDto.fromJson(Object? input) {
    final json = _object(input, 'prompt set', const {
      'level1',
      'level2',
      'level3',
    });
    return PromptSetDto(
      level1: _localized(json['level1'], 'prompts.level1'),
      level2: _localized(json['level2'], 'prompts.level2'),
      level3: _localized(json['level3'], 'prompts.level3'),
    );
  }

  final LocalizedText level1;
  final LocalizedText level2;
  final LocalizedText level3;
}

class TransferTaskDto {
  const TransferTaskDto({
    required this.changedInformation,
    required this.changedRelationship,
    required this.unfamiliarVariant,
  });

  factory TransferTaskDto.fromJson(Object? input) {
    final json = _object(input, 'transfer task', const {
      'changedInformation',
      'changedRelationship',
      'unfamiliarVariant',
    });
    return TransferTaskDto(
      changedInformation: _localized(
        json['changedInformation'],
        'transfer.changedInformation',
      ),
      changedRelationship: _localized(
        json['changedRelationship'],
        'transfer.changedRelationship',
      ),
      unfamiliarVariant: _localized(
        json['unfamiliarVariant'],
        'transfer.unfamiliarVariant',
      ),
    );
  }

  final LocalizedText changedInformation;
  final LocalizedText changedRelationship;
  final LocalizedText unfamiliarVariant;
}

class ScenarioTaskDto {
  const ScenarioTaskDto({
    required this.position,
    required this.goalKey,
    required this.prompt,
    required this.successCriteria,
    required this.targetExpressionKeys,
    required this.prompts,
    required this.transfer,
  });

  factory ScenarioTaskDto.fromJson(Object? input) {
    final json = _object(input, 'scenario task', const {
      'position',
      'goalKey',
      'prompt',
      'successCriteria',
      'targetExpressionKeys',
      'prompts',
      'transfer',
    });
    return ScenarioTaskDto(
      position: _position(json['position'], 'scenarioTask.position'),
      goalKey: _stableKey(json['goalKey'], 'scenarioTask.goalKey'),
      prompt: _localized(json['prompt'], 'scenarioTask.prompt'),
      successCriteria: _jsonObject(
        json['successCriteria'],
        'scenarioTask.successCriteria',
      ),
      targetExpressionKeys: _stableKeyList(
        json['targetExpressionKeys'],
        'scenarioTask.targetExpressionKeys',
      ),
      prompts: PromptSetDto.fromJson(json['prompts']),
      transfer: TransferTaskDto.fromJson(json['transfer']),
    );
  }

  final int position;
  final String goalKey;
  final LocalizedText prompt;
  final JsonObject successCriteria;
  final List<String> targetExpressionKeys;
  final PromptSetDto prompts;
  final TransferTaskDto transfer;
}

class ContentScenarioDto {
  const ContentScenarioDto({
    required this.stableKey,
    required this.version,
    required this.title,
    required this.description,
    required this.setting,
    required this.relationshipType,
    required this.cefr,
    required this.status,
    required this.tasks,
  });

  factory ContentScenarioDto.fromJson(Object? input) {
    final json = _object(input, 'scenario', const {
      'stableKey',
      'version',
      'title',
      'description',
      'setting',
      'relationshipType',
      'cefr',
      'status',
      'tasks',
    });
    return ContentScenarioDto(
      stableKey: _stableKey(json['stableKey'], 'scenario.stableKey'),
      version: _positiveInt(json['version'], 'scenario.version'),
      title: _localized(json['title'], 'scenario.title'),
      description: _localized(json['description'], 'scenario.description'),
      setting: _string(json['setting'], 'scenario.setting'),
      relationshipType: _stableKey(
        json['relationshipType'],
        'scenario.relationshipType',
      ),
      cefr: _enum(json['cefr'], 'scenario.cefr', _cefrOrder.toSet()),
      status: _enum(json['status'], 'scenario.status', _contentStatuses),
      tasks: _typedList(
        json['tasks'],
        'scenario.tasks',
        ScenarioTaskDto.fromJson,
      ),
    );
  }

  final String stableKey;
  final int version;
  final LocalizedText title;
  final LocalizedText description;
  final String setting;
  final String relationshipType;
  final String cefr;
  final String status;
  final List<ScenarioTaskDto> tasks;
}

class ContentSegmentDto {
  const ContentSegmentDto({
    required this.position,
    required this.text,
    required this.translations,
    required this.chunks,
  });

  factory ContentSegmentDto.fromJson(Object? input) {
    final json = _object(input, 'content segment', const {
      'position',
      'text',
      'translations',
      'chunks',
    });
    return ContentSegmentDto(
      position: _position(json['position'], 'segment.position'),
      text: _string(json['text'], 'segment.text'),
      translations: _localized(json['translations'], 'segment.translations'),
      chunks: _typedList(
        json['chunks'],
        'segment.chunks',
        ContentChunkDto.fromJson,
      ),
    );
  }

  final int position;
  final String text;
  final LocalizedText translations;
  final List<ContentChunkDto> chunks;
}

class ContentActivityDto {
  const ContentActivityDto({
    required this.position,
    required this.segmentPosition,
    required this.activityType,
    required this.modality,
    required this.instructions,
    required this.configuration,
  });

  factory ContentActivityDto.fromJson(Object? input) {
    final json = _object(input, 'content activity', const {
      'position',
      'segmentPosition',
      'activityType',
      'modality',
      'instructions',
      'configuration',
    });
    return ContentActivityDto(
      position: _position(json['position'], 'activity.position'),
      segmentPosition: json['segmentPosition'] == null
          ? null
          : _position(json['segmentPosition'], 'activity.segmentPosition'),
      activityType: _enum(
        json['activityType'],
        'activity.activityType',
        _activityTypes,
      ),
      modality: _enum(json['modality'], 'activity.modality', _modalities),
      instructions: _localized(json['instructions'], 'activity.instructions'),
      configuration: _jsonObject(
        json['configuration'],
        'activity.configuration',
      ),
    );
  }

  final int position;
  final int? segmentPosition;
  final String activityType;
  final String modality;
  final LocalizedText instructions;
  final JsonObject configuration;
}

class ContentSourceDto {
  const ContentSourceDto({
    required this.sourceType,
    required this.title,
    required this.author,
    required this.sourceUrl,
    required this.license,
    required this.attribution,
    required this.licenseEvidence,
    required this.copyrightStatus,
    required this.reviewNotes,
  });

  factory ContentSourceDto.fromJson(Object? input) {
    final json = _object(input, 'content source', const {
      'sourceType',
      'title',
      'author',
      'sourceUrl',
      'license',
      'attribution',
      'licenseEvidence',
      'copyrightStatus',
      'reviewNotes',
    });
    final sourceUrl = _optionalString(json['sourceUrl'], 'source.sourceUrl');
    if (sourceUrl != null && Uri.tryParse(sourceUrl)?.hasAbsolutePath != true) {
      throw ContentBundleFormatException('source.sourceUrl must be absolute.');
    }
    return ContentSourceDto(
      sourceType: _enum(json['sourceType'], 'source.sourceType', _sourceTypes),
      title: _string(json['title'], 'source.title'),
      author: _optionalString(json['author'], 'source.author'),
      sourceUrl: sourceUrl,
      license: _enum(json['license'], 'source.license', _sourceLicenses),
      attribution: _optionalString(json['attribution'], 'source.attribution'),
      licenseEvidence: _optionalString(
        json['licenseEvidence'],
        'source.licenseEvidence',
      ),
      copyrightStatus: _enum(
        json['copyrightStatus'],
        'source.copyrightStatus',
        _copyrightStatuses,
      ),
      reviewNotes: _optionalString(json['reviewNotes'], 'source.reviewNotes'),
    );
  }

  final String sourceType;
  final String title;
  final String? author;
  final String? sourceUrl;
  final String license;
  final String? attribution;
  final String? licenseEvidence;
  final String copyrightStatus;
  final String? reviewNotes;
}

class ContentPackDto {
  const ContentPackDto({
    required this.stableKey,
    required this.version,
    required this.title,
    required this.summary,
    required this.cefr,
    required this.status,
    required this.publishedAt,
    required this.segments,
    required this.activities,
    required this.sources,
  });

  factory ContentPackDto.fromJson(Object? input) {
    final json = _object(input, 'content pack', const {
      'stableKey',
      'version',
      'title',
      'summary',
      'cefr',
      'status',
      'publishedAt',
      'segments',
      'activities',
      'sources',
    });
    return ContentPackDto(
      stableKey: _stableKey(json['stableKey'], 'contentPack.stableKey'),
      version: _positiveInt(json['version'], 'contentPack.version'),
      title: _localized(json['title'], 'contentPack.title'),
      summary: _localized(json['summary'], 'contentPack.summary'),
      cefr: _enum(json['cefr'], 'contentPack.cefr', _cefrOrder.toSet()),
      status: _enum(json['status'], 'contentPack.status', _contentStatuses),
      publishedAt: _optionalDate(
        json['publishedAt'],
        'contentPack.publishedAt',
      ),
      segments: _typedList(
        json['segments'],
        'contentPack.segments',
        ContentSegmentDto.fromJson,
      ),
      activities: _typedList(
        json['activities'],
        'contentPack.activities',
        ContentActivityDto.fromJson,
      ),
      sources: _typedList(
        json['sources'],
        'contentPack.sources',
        ContentSourceDto.fromJson,
      ),
    );
  }

  final String stableKey;
  final int version;
  final LocalizedText title;
  final LocalizedText summary;
  final String cefr;
  final String status;
  final DateTime? publishedAt;
  final List<ContentSegmentDto> segments;
  final List<ContentActivityDto> activities;
  final List<ContentSourceDto> sources;
}

class CanonFactDto {
  const CanonFactDto({
    required this.factKey,
    required this.value,
    required this.sensitivity,
    required this.version,
    required this.isActive,
  });

  factory CanonFactDto.fromJson(Object? input) {
    final json = _object(input, 'canon fact', const {
      'factKey',
      'value',
      'sensitivity',
      'version',
      'isActive',
    });
    return CanonFactDto(
      factKey: _stableKey(json['factKey'], 'canonFact.factKey'),
      value: _jsonObject(json['value'], 'canonFact.value'),
      sensitivity: _enum(
        json['sensitivity'],
        'canonFact.sensitivity',
        _sensitivities,
      ),
      version: _positiveInt(json['version'], 'canonFact.version'),
      isActive: _bool(json['isActive'], 'canonFact.isActive'),
    );
  }

  final String factKey;
  final JsonObject value;
  final String sensitivity;
  final int version;
  final bool isActive;
}

class ContentCharacterDto {
  const ContentCharacterDto({
    required this.stableKey,
    required this.version,
    required this.displayName,
    required this.avatarUrl,
    required this.homeLocation,
    required this.profile,
    required this.status,
    required this.canonFacts,
  });

  factory ContentCharacterDto.fromJson(Object? input) {
    final json = _object(input, 'character', const {
      'stableKey',
      'version',
      'displayName',
      'avatarUrl',
      'homeLocation',
      'profile',
      'status',
      'canonFacts',
    });
    return ContentCharacterDto(
      stableKey: _stableKey(json['stableKey'], 'character.stableKey'),
      version: _positiveInt(json['version'], 'character.version'),
      displayName: _string(json['displayName'], 'character.displayName'),
      avatarUrl: _optionalString(json['avatarUrl'], 'character.avatarUrl'),
      homeLocation: _string(json['homeLocation'], 'character.homeLocation'),
      profile: _jsonObject(json['profile'], 'character.profile'),
      status: _enum(json['status'], 'character.status', _contentStatuses),
      canonFacts: _typedList(
        json['canonFacts'],
        'character.canonFacts',
        CanonFactDto.fromJson,
      ),
    );
  }

  final String stableKey;
  final int version;
  final String displayName;
  final String? avatarUrl;
  final String homeLocation;
  final JsonObject profile;
  final String status;
  final List<CanonFactDto> canonFacts;
}

class ArticleDto {
  const ArticleDto({
    required this.stableKey,
    required this.version,
    required this.locale,
    required this.title,
    required this.summary,
    required this.status,
    required this.contentHash,
    required this.segments,
    this.oralTransferType = 'none',
  });

  factory ArticleDto.fromJson(Object? input) {
    final json = _object(input, 'article', const {
      'stableKey',
      'version',
      'locale',
      'title',
      'summary',
      'source',
      'publishedAt',
      'curatedAt',
      'contentHash',
      'cefr',
      'topics',
      'region',
      'register',
      'format',
      'estimatedReadingMinutes',
      'assets',
      'relatedExpressionKeys',
      'relatedGoalKeys',
      'relatedTagKeys',
      'oralTransferType',
      'status',
      'changeReason',
      'reviewNotes',
      'segments',
    });
    final segments = _typedList(
      json['segments'],
      'article.segments',
      ArticleSegmentDto.fromJson,
    );
    final positions = segments.map((segment) => segment.position).toList()
      ..sort();
    if (positions.asMap().entries.any((entry) => entry.value != entry.key)) {
      throw ContentBundleFormatException(
        'article segment positions must be contiguous.',
      );
    }
    return ArticleDto(
      stableKey: _stableKey(json['stableKey'], 'article.stableKey'),
      version: _positiveInt(json['version'], 'article.version'),
      locale: _locale(json['locale'], 'article.locale'),
      title: _string(json['title'], 'article.title'),
      summary: _string(json['summary'], 'article.summary'),
      status: _enum(json['status'], 'article.status', _contentStatuses),
      contentHash: _string(json['contentHash'], 'article.contentHash'),
      segments: segments,
      oralTransferType: _enum(
        json['oralTransferType'],
        'article.oralTransferType',
        const {'none', 'summary', 'opinion', 'personal_transfer'},
      ),
    );
  }

  final String stableKey;
  final int version;
  final String locale;
  final String title;
  final String summary;
  final String status;
  final String contentHash;
  final List<ArticleSegmentDto> segments;
  final String oralTransferType;
}

class ArticleSegmentDto {
  const ArticleSegmentDto({required this.position, required this.text});

  factory ArticleSegmentDto.fromJson(Object? input) {
    final json = _object(input, 'article segment', const {'position', 'text'});
    return ArticleSegmentDto(
      position: _position(json['position'], 'article.segment.position'),
      text: _string(json['text'], 'article.segment.text'),
    );
  }

  final int position;
  final String text;
}

class ContentReviewDto {
  const ContentReviewDto({
    required this.entityType,
    required this.stableKey,
    required this.version,
    required this.locale,
    required this.status,
    required this.reviewerReference,
    required this.notes,
    required this.reviewedAt,
  });

  factory ContentReviewDto.fromJson(Object? input) {
    final json = _object(input, 'content review', const {
      'entityType',
      'stableKey',
      'version',
      'locale',
      'status',
      'reviewerReference',
      'notes',
      'reviewedAt',
    });
    return ContentReviewDto(
      entityType: _enum(
        json['entityType'],
        'review.entityType',
        _reviewEntityTypes,
      ),
      stableKey: _stableKey(json['stableKey'], 'review.stableKey'),
      version: json['version'] == null
          ? null
          : _positiveInt(json['version'], 'review.version'),
      locale: _locale(json['locale'], 'review.locale'),
      status: _enum(json['status'], 'review.status', _reviewStatuses),
      reviewerReference: _optionalString(
        json['reviewerReference'],
        'review.reviewerReference',
      ),
      notes: _optionalString(json['notes'], 'review.notes'),
      reviewedAt: _optionalDate(json['reviewedAt'], 'review.reviewedAt'),
    );
  }

  final String entityType;
  final String stableKey;
  final int? version;
  final String locale;
  final String status;
  final String? reviewerReference;
  final String? notes;
  final DateTime? reviewedAt;
}

const _stableKeyPattern = r'^[a-z0-9]+(?:[._-][a-z0-9]+)*$';
const _localePattern = r'^[a-z]{2,3}(?:-[A-Z]{2})?$';
const _contentStatuses = {
  'draft',
  'review',
  'approved',
  'published',
  'archived',
};
const _reviewStatuses = {'pending', 'approved', 'changes_requested'};
const _cefrOrder = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const _tagCategories = {
  'domain',
  'task',
  'chunk',
  'grammar',
  'pronunciation',
  'register',
  'relationship',
  'region',
  'cefr',
  'transfer',
  'fluency',
};
const _chunkKinds = {'sense_group', 'target', 'connector'};
const _frequencies = {'core', 'common', 'extension'};
const _activityTypes = {
  'listening',
  'shadowing',
  'reading',
  'typing',
  'speaking',
  'transfer',
};
const _modalities = {'speech', 'typing', 'listening', 'reading'};
const _sourceTypes = {
  'original',
  'ai_assisted_original',
  'public_domain',
  'creative_commons',
  'licensed',
  'short_quote',
};
const _sourceLicenses = {
  'original',
  'public_domain',
  'creative_commons',
  'licensed',
  'short_quote',
};
const _copyrightStatuses = {'unverified', 'cleared', 'restricted'};
const _sensitivities = {'normal', 'sensitive', 'private'};
const _reviewEntityTypes = {
  'communication_domain',
  'learning_goal',
  'expression',
  'scenario',
  'content_pack',
  'character',
  'article',
};
const _versionedReviewTypes = {
  'expression',
  'scenario',
  'content_pack',
  'character',
  'article',
};

Map<String, Object?> _object(
  Object? input,
  String field,
  Set<String> allowedKeys,
) {
  if (input is! Map) {
    throw ContentBundleFormatException('$field must be an object.');
  }
  late final Map<String, Object?> result;
  try {
    result = Map<String, Object?>.from(input);
  } on TypeError {
    throw ContentBundleFormatException('$field must use string keys.');
  }
  final unknown = result.keys.where((key) => !allowedKeys.contains(key));
  if (unknown.isNotEmpty) {
    throw ContentBundleFormatException(
      '$field contains unsupported field ${unknown.first}.',
    );
  }
  return result;
}

JsonObject _jsonObject(Object? input, String field) {
  if (input is! Map) {
    throw ContentBundleFormatException('$field must be an object.');
  }
  try {
    return Map<String, Object?>.from(input);
  } on TypeError {
    throw ContentBundleFormatException('$field must use string keys.');
  }
}

List<T> _typedList<T>(Object? input, String field, T Function(Object?) parse) {
  if (input is! List) {
    throw ContentBundleFormatException('$field must be an array.');
  }
  return input.map(parse).toList(growable: false);
}

String _string(Object? input, String field) {
  if (input is! String || input.trim().isEmpty) {
    throw ContentBundleFormatException('$field must be a non-empty string.');
  }
  return input.trim();
}

String? _optionalString(Object? input, String field) {
  if (input == null) return null;
  return _string(input, field);
}

bool _bool(Object? input, String field) {
  if (input is! bool) {
    throw ContentBundleFormatException('$field must be a boolean.');
  }
  return input;
}

double _number(Object? input, String field) {
  if (input is! num || !input.isFinite) {
    throw ContentBundleFormatException('$field must be a finite number.');
  }
  return input.toDouble();
}

int _positiveInt(Object? input, String field) {
  if (input is! int || input <= 0) {
    throw ContentBundleFormatException('$field must be a positive integer.');
  }
  return input;
}

int _position(Object? input, String field) {
  if (input is! int || input < 0) {
    throw ContentBundleFormatException(
      '$field must be a non-negative integer.',
    );
  }
  return input;
}

String _enum(Object? input, String field, Set<String> allowed) {
  final value = _string(input, field);
  if (!allowed.contains(value)) {
    throw ContentBundleFormatException('$field has unsupported value $value.');
  }
  return value;
}

String _stableKey(Object? input, String field) {
  final value = _string(input, field);
  if (!RegExp(_stableKeyPattern).hasMatch(value)) {
    throw ContentBundleFormatException('$field is not a stable key.');
  }
  return value;
}

String _locale(Object? input, String field) {
  final value = _string(input, field);
  if (!RegExp(_localePattern).hasMatch(value)) {
    throw ContentBundleFormatException('$field is not a locale.');
  }
  return value;
}

LocalizedText _localized(Object? input, String field) {
  final json = _jsonObject(input, field);
  if (json.isEmpty) {
    throw ContentBundleFormatException('$field cannot be empty.');
  }
  return json.map((key, value) {
    _locale(key, '$field locale');
    return MapEntry(key, _string(value, '$field.$key'));
  });
}

List<String> _stringList(Object? input, String field) {
  if (input is! List || input.isEmpty) {
    throw ContentBundleFormatException('$field must be a non-empty array.');
  }
  return input
      .map((value) => _string(value, '$field item'))
      .toList(growable: false);
}

List<String> _stableKeyList(Object? input, String field) {
  if (input is! List || input.isEmpty) {
    throw ContentBundleFormatException('$field must be a non-empty array.');
  }
  return input
      .map((value) => _stableKey(value, '$field item'))
      .toList(growable: false);
}

DateTime? _optionalDate(Object? input, String field) {
  if (input == null) return null;
  final value = _string(input, field);
  final parsed = DateTime.tryParse(value);
  if (parsed == null ||
      (!value.endsWith('Z') && !value.contains(RegExp(r'[+-]\d\d:\d\d$')))) {
    throw ContentBundleFormatException(
      '$field must be an ISO timestamp with offset.',
    );
  }
  return parsed;
}

void _requireUnique(Iterable<String> values, String field) {
  final seen = <String>{};
  for (final value in values) {
    if (!seen.add(value)) {
      throw ContentBundleFormatException('Duplicate $field: $value');
    }
  }
}

String _versioned(String stableKey, int version) => '$stableKey@$version';

String _reviewKey(String type, String stableKey, int? version) =>
    '$type:$stableKey${version == null ? '' : '@$version'}';
