// Portions (c) Microsoft Corp.

const fs = require('fs');
const path = require('path');

// Read AKS desktop version from the root package.json
// Try multiple possible locations to handle different working directory contexts
let aksDesktopVersion;
const possiblePaths = [
  path.join(__dirname, '../../package.json'), // Normal case: from headlamp/app in monorepo
  path.join(__dirname, '../package.json'), // Standalone headlamp: use headlamp's package.json
  path.join(process.cwd(), '../../package.json'), // Relative to current working directory
  path.join(__dirname, '../../../package.json'), // In case we're in a nested context
];

let foundPath = null;
for (const pkgPath of possiblePaths) {
  try {
    if (fs.existsSync(pkgPath)) {
      const aksDesktopPackageJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      aksDesktopVersion = aksDesktopPackageJson.version;
      foundPath = pkgPath;
      console.log(`Successfully read AKS desktop version ${aksDesktopVersion} from ${pkgPath}`);
      break;
    }
  } catch (e) {
    // Continue to next path
  }
}

if (!aksDesktopVersion) {
  console.error('Could not read AKS desktop version from package.json');
  console.error('Tried the following paths:');
  possiblePaths.forEach(p => console.error(`  - ${p}`));
  console.error(`__dirname: ${__dirname}`);
  console.error(`process.cwd(): ${process.cwd()}`);
  process.exit(1);
}

// Read the base package.json to get the build configuration
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));

// Override the build configuration with the AKS desktop version
const config = {
  ...packageJson.build,
  buildVersion: aksDesktopVersion,
  // Use buildVersion in artifact names
  artifactName: '${name}-' + aksDesktopVersion + '-${os}-${arch}.${ext}',
  // Override Mac-specific version settings
  mac: {
    ...packageJson.build.mac,
    // Set CFBundleShortVersionString and CFBundleVersion to use AKS desktop version
    // This ensures the Mac app shows the correct version in Finder, About dialog, etc.
    bundleShortVersion: aksDesktopVersion,
    bundleVersion: aksDesktopVersion,
  },
};

// Override the deb artifactName as well
if (config.deb) {
  config.deb = {
    ...config.deb,
    artifactName: '${name}_' + aksDesktopVersion + '-1_${arch}.${ext}',
  };
}

// Override productName for Linux builds to avoid spaces in installation path
if (
  process.argv.includes('--linux') &&
  !process.argv.includes('--win') &&
  !process.argv.includes('--mac')
) {
  config.productName = 'AKS-Desktop';
}

// On non-Mac platforms, ensure dmg-license is truly optional by not including Mac targets during --dir builds
// This prevents electron-builder from trying to validate Mac-specific dependencies on Linux/Windows
if (process.env.npm_lifecycle_event === 'build' && process.platform !== 'darwin') {
  // For unpacked builds on non-Mac, don't include Mac configuration
  delete config.mac;
}

module.exports = config;
