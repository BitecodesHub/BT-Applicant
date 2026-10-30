import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const E2E_ROOT = join(tmpdir(), 'bt-applicant-e2e')
export const USER_DATA = join(E2E_ROOT, 'userdata')
export const MANIFEST = join(E2E_ROOT, 'manifest.json')
export const UPLOAD_FILE = join(E2E_ROOT, 'upload-resume.txt')
export const SHOTS = join(process.cwd(), 'docs', 'screenshots')
