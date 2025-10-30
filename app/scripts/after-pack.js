'use strict';

const child_process = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

exports.default = async context => {
  if (fs.existsSync('.env')) {
    console.info('Copying .env file to app resources directory!');
    try {
      fs.copyFileSync('.env', path.join(context.appOutDir, 'resources', '.env'));
    } catch (err) {
      console.error('Failed to copy .env after pack:', err);
    }
  }

  // Run post-build verification to ensure external tools are bundled correctly
  console.log('\n========================================');
  console.log('Running post-build verification tests...');
  console.log('========================================\n');

  const verifyScript = path.join(__dirname, '../../../build/verify-bundled-tools.ts');

  if (fs.existsSync(verifyScript)) {
    try {
      // Run the verification script using tsx
      const result = child_process.spawnSync('npx', ['--yes', 'tsx', verifyScript], {
        stdio: 'inherit',
        cwd: path.join(__dirname, '../../..'),
        shell: true,
      });

      if (result.status !== 0) {
        console.error('\n❌ Post-build verification FAILED!');
        console.error('The bundled external tools are not correctly configured.');
        process.exit(1);
      }

      console.log('\n✅ Post-build verification PASSED!');
    } catch (err) {
      console.error('Failed to run post-build verification:', err);
      console.error('⚠️  Continuing build, but external tools may not be bundled correctly.');
    }
  } else {
    console.warn('⚠️  Post-build verification script not found at:', verifyScript);
    console.warn('Skipping verification. External tools may not be bundled correctly.');
  }
};
