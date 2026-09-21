# Sueño Shared Primitives

These files are Sueño-owned source, organized to be compatible with the shadcn/ui registry model. They intentionally do not import a remote registry at runtime. The behavior contracts are documented in `docs/superpowers/specs/2026-09-21-sueño-ui-composition-and-motion-technical-research.md`.

Source/attribution:

- Composition and accessibility API shape: shadcn/ui, MIT, https://ui.shadcn.com/docs
- Focus, dialog, popover and keyboard behavior to audit against: Radix Primitives, MIT, https://www.radix-ui.com/primitives/docs/overview/introduction
- Motion patterns: Transitions.dev, MIT, https://transitions.dev

Before copying any third-party file into this directory, record the exact URL, version/commit and license in the task document. Feature modules must consume these primitives through this directory; they must not import a registry URL or a provider runtime.

Modal usage must include `SheetTitle` or `AlertDialogTitle`; use the description companion for alert dialogs when explanatory copy is present. The local implementation owns focus return, Escape handling, tab containment, and temporary body scroll locking.
