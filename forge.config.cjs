const { execFileSync } = require('node:child_process')
const path = require('node:path')

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
module.exports = {
  packagerConfig: {
    name: 'Mareo',
    icon: path.join(__dirname, '.cache', 'icons', 'mareo.icns'),
    appBundleId: 'app.mareo.desktop',
    appCategoryType: 'public.app-category.productivity',
    asar: true,
    extendInfo: {
      NSAppTransportSecurity: {
        NSAllowsLocalNetworking: true,
      },
    },
    extraResource: ['.staging/dsh-runtime', '.staging/node-runtime'],
    ignore: [
      /^\/\.cache(?:\/|$)/,
      /^\/\.staging(?:\/|$)/,
      /^\/dist\/tests(?:\/|$)/,
      /^\/runtime(?:\/|$)/,
      /^\/scripts(?:\/|$)/,
      /^\/tests(?:\/|$)/,
      /^\/src\/.*\.ts$/,
    ],
  },
  makers: [
    {
      name: '@electron-forge/maker-dmg',
      config: {
        format: 'ULFO',
      },
    },
  ],
  hooks: {
    generateAssets: async () => {
      execFileSync(process.execPath, [path.join(__dirname, 'scripts', 'generate-icon.mjs')])
    },
    postPackage: async (_forgeConfig, { platform, outputPaths }) => {
      if (platform !== 'darwin') return
      const unusedPermissions = [
        'NSAudioCaptureUsageDescription',
        'NSBluetoothAlwaysUsageDescription',
        'NSBluetoothPeripheralUsageDescription',
        'NSCameraUsageDescription',
        'NSMicrophoneUsageDescription',
      ]
      for (const outputPath of outputPaths) {
        const infoPlist = path.join(outputPath, 'Mareo.app', 'Contents', 'Info.plist')
        for (const permission of unusedPermissions) {
          execFileSync('/usr/bin/plutil', ['-remove', permission, infoPlist])
        }
      }
    },
  },
}
