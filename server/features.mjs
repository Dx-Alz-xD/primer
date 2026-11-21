// Feature modules the server loads after accounts and user data.
// Each one exports `routes` (and optionally `pages`: [{ file, protected }]
// and `boot(user)`: extra settings for the page).
// Add a line here to plug in a new feature.
export default [
  () => import('./tutor.mjs'),
  () => import('./voice.mjs'),
  () => import('./community.mjs'),
  () => import('./folders.mjs'),
  () => import('./library.mjs'),
  () => import('./translate.mjs'),
  () => import('./classes.mjs'),
  () => import('./ebook.mjs'),
  () => import('./review.mjs'),
  () => import('./placement.mjs'),
  () => import('./marking.mjs'),
  () => import('./offline.mjs'),
  () => import('./photos.mjs'),
  () => import('./videos.mjs'),
  () => import('./refs.mjs') // a lesson's sources and the apps to practise it in (with sources.mjs, apps.mjs)
];
