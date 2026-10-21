import { ACR_ARCHIVE_SCRIPT_PATH, acrArchiveScript } from './archiveScript';
import { acrTaskRunnerScript } from './runnerScript';

/** ARM API version used by the shared ACR Tasks build/cancel runtime. */
export const ACR_TASKS_API_VERSION = '2019-04-01';
/** Repository-relative entry point invoked by generated workflows. */
export const ACR_BUILD_SCRIPT_PATH = '.github/scripts/aksd-acr-build.py';

/**
 * Supplies the Python build/cancel runner and local context-packaging helper without writing files.
 * Portable to both the plugin and root tsx consumers.
 *
 * @returns Repository-relative file paths mapped to their complete Python source text.
 */
export function getAcrBuildFiles(): Record<string, string> {
  return {
    [ACR_BUILD_SCRIPT_PATH]: acrTaskRunnerScript,
    [ACR_ARCHIVE_SCRIPT_PATH]: acrArchiveScript,
  };
}
