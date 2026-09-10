/**
 * Squirrel.Windows launches the app with lifecycle arguments during install,
 * update and uninstall. The app is responsible for acting on them — most
 * importantly creating/removing shortcuts — because Squirrel itself only
 * extracts files.
 */
export type SquirrelAction = 'create-shortcuts' | 'remove-shortcuts' | 'quit'

export function squirrelActionFor(argv: string[], platform: NodeJS.Platform = process.platform): SquirrelAction | undefined {
  if (platform !== 'win32') return undefined
  switch (argv[1]) {
    case '--squirrel-install':
    case '--squirrel-updated':
      return 'create-shortcuts'
    case '--squirrel-uninstall':
      return 'remove-shortcuts'
    case '--squirrel-obsolete':
      return 'quit'
    default:
      return undefined
  }
}
