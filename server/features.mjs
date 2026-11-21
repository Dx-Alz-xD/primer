// Feature modules the server loads after accounts and user data.
// Each one exports `routes` (and optionally `pages`: [{ file, protected }]).
// Add a line here to plug in a new feature.
export default [
  () => import('./folders.mjs')
];
