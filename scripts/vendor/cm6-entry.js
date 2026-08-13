// CM6 API surface used by Dojo.
// Update this file when adopting new CM6 features — it is the explicit contract.
// Run `node vendor-cm6.mjs` after changes to rebuild priv/static/vendor/cm6.js.

export {
  EditorView,
  Decoration,
  ViewPlugin,
  MatchDecorator,
  WidgetType,
  hoverTooltip,
  showTooltip,
  tooltips,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
  highlightSpecialChars,
  scrollPastEnd,
  gutter,
  GutterMarker,
} from "@codemirror/view"

export {
  EditorState,
  EditorSelection,
  Compartment,
  StateEffect,
  StateField,
  Transaction,
  RangeSetBuilder,
  Text,
} from "@codemirror/state"

export {
  StreamLanguage,
  LanguageSupport,
  bracketMatching,
  foldGutter,
  foldKeymap,
  foldNodeProp,
  indentOnInput,
  foldService,
  syntaxHighlighting,
  defaultHighlightStyle,
  indentUnit,
  HighlightStyle,
  highlightingFor,
} from "@codemirror/language"

export {
  defaultKeymap,
  historyKeymap,
  history,
  indentWithTab,
  undo,
  redo,
} from "@codemirror/commands"

export {
  setDiagnostics,
  lintGutter,
  diagnosticCount,
  openLintPanel,
  closeLintPanel,
} from "@codemirror/lint"

export {
  autocompletion,
  completionKeymap,
  startCompletion,
  closeCompletion,
  acceptCompletion,
  completionStatus,
} from "@codemirror/autocomplete"

export { MergeView, unifiedMergeView, updateOriginalDoc, getOriginalDoc } from "@codemirror/merge"

export { styleTags, tags, tagHighlighter, classHighlighter } from "@lezer/highlight"
