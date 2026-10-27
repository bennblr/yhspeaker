// Dependencies are installed once at the monorepo root; returning false keeps
// electron-builder from running npm inside the workspace and pruning devDeps.
module.exports = async () => false;
