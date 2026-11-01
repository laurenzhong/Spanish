# Sueño Shared Primitives

These files are Sueño-owned source, organized to be compatible with the shadcn/ui registry model. They intentionally do not import a remote registry at runtime. The behavior contracts are documented in `docs/superpowers/specs/2026-09-21-sueño-ui-composition-and-motion-technical-research.md`.

The locally owned additions used by the product are:

- `OtpInput`: one accessible, autofill-friendly code field with segmented visual slots.
- `ScrollProgress`: clamped progressbar semantics for reading and media surfaces.
- `AiStatus`: a small assistant state cue that does not own request state.
- `StepPlayer`: completed/current/upcoming learning steps.
- `PromptBar`: a composition shell for chat input controls.

The complete reusable catalog now also includes the agreed P0/P1 building
blocks:

- P0: `Button`, `Input`, `Textarea`, `Label`, `Field`, `Badge`, `Card`,
  `Separator`, `Alert`, `EmptyState`, `Progress`.
- P1: `DropdownMenu`, `Command`, `Combobox`, `Breadcrumb`, `Pagination`,
  `Checkbox`, `RadioGroup`, `Switch`, `ToggleGroup`, `Accordion`, and
  `Collapsible`.

Existing local primitives remain available alongside them: `AlertDialog`,
`Popover`, `ScrollArea`, `Select`, `Sheet`, `Skeleton`, `Tabs`, and `Tooltip`.

These are informed by [Beautiful UI](https://www.beautifului.dev/), [beUI](https://beui.dev/), [Rare UI](https://www.rareui.com/components), [Transitions](https://transitions.dev/) and [shadcn/ui](https://ui.shadcn.com/). No third-party source file or runtime dependency was copied into the repository.

The complete component-by-component address list, including reviewed but deferred references, is maintained in [`docs/reviews/UI-COMPONENTS-001.md`](../../../docs/reviews/UI-COMPONENTS-001.md).

Authenticated users can interact with the catalog at `/me/ui-catalog`.

`ActivityHeatmap` is a local calendar visualization used directly at
`/me#profile-progress`. It accepts ordered calendar dates, five intensity levels,
accessible labels and a selection callback. The profile feature owns duration
thresholds, API loading and day details. Keyboard navigation, month/weekday
alignment, themed cells and touch scrolling live in the primitive and its CSS module.

Source/attribution:

- Composition and accessibility API shape: shadcn/ui, MIT, https://ui.shadcn.com/docs
- Focus, dialog, popover and keyboard behavior to audit against: Radix Primitives, MIT, https://www.radix-ui.com/primitives/docs/overview/introduction
- Motion patterns: Transitions.dev, MIT, https://transitions.dev

Before copying any third-party file into this directory, record the exact URL, version/commit and license in the task document. Feature modules must consume these primitives through this directory; they must not import a registry URL or a provider runtime.

Modal usage must include `SheetTitle` or `AlertDialogTitle`; use the description companion for alert dialogs when explanatory copy is present. The local implementation owns focus return, Escape handling, tab containment, and temporary body scroll locking.
