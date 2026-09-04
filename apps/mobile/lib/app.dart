import 'package:flutter/material.dart';
import 'package:spanish_mobile/core/auth/auth_repository.dart';
import 'package:spanish_mobile/core/auth/auth_session.dart';
import 'package:spanish_mobile/features/auth/login_page.dart';
import 'package:spanish_mobile/features/explore/data/explore_api.dart';
import 'package:spanish_mobile/shared/widgets/product_shell.dart';

class SpanishApp extends StatelessWidget {
  const SpanishApp({this.authSessionSource, this.authRepository, this.exploreApi, super.key});

  final AuthSessionSource? authSessionSource;
  final AuthRepository? authRepository;
  final ExploreApi? exploreApi;

  @override
  Widget build(BuildContext context) {
    const seed = Color(0xFF1769E0);
    final colorScheme = ColorScheme.fromSeed(
      seedColor: seed,
      surface: const Color(0xFFF8FAFD),
    );

    return MaterialApp(
      title: 'Sueño',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: colorScheme,
        scaffoldBackgroundColor: const Color(0xFFF4F7FB),
        useMaterial3: true,
        filledButtonTheme: FilledButtonThemeData(
          style: FilledButton.styleFrom(
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
            ),
            textStyle: const TextStyle(fontWeight: FontWeight.w800),
          ),
        ),
        navigationBarTheme: NavigationBarThemeData(
          height: 72,
          backgroundColor: Colors.white,
          indicatorColor: colorScheme.primaryContainer,
          labelTextStyle: WidgetStateProperty.resolveWith((states) {
            return TextStyle(
              color: states.contains(WidgetState.selected)
                  ? colorScheme.primary
                  : colorScheme.onSurfaceVariant,
              fontSize: 11,
              fontWeight: FontWeight.w700,
            );
          }),
        ),
        navigationRailTheme: NavigationRailThemeData(
          backgroundColor: Colors.white,
          indicatorColor: colorScheme.primaryContainer,
          selectedIconTheme: IconThemeData(color: colorScheme.primary),
          selectedLabelTextStyle: TextStyle(
            color: colorScheme.primary,
            fontWeight: FontWeight.w800,
          ),
        ),
      ),
      home: _AuthGate(
        authSessionSource: authSessionSource,
        authRepository: authRepository,
        exploreApi: exploreApi,
      ),
    );
  }
}

class _AuthGate extends StatelessWidget {
  const _AuthGate({
    required this.authSessionSource,
    required this.authRepository,
    required this.exploreApi,
  });

  final AuthSessionSource? authSessionSource;
  final AuthRepository? authRepository;
  final ExploreApi? exploreApi;

  @override
  Widget build(BuildContext context) {
    final source = authSessionSource;
    if (source == null) {
      return LoginPage(repository: authRepository);
    }

    return StreamBuilder<AuthSessionSnapshot?>(
      initialData: source.currentSession,
      stream: source.sessions,
      builder: (context, snapshot) {
        if (snapshot.data == null) {
          return LoginPage(repository: authRepository);
        }
        return ProductShell(userId: snapshot.data!.userId, exploreApi: exploreApi);
      },
    );
  }
}
