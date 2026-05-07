// Vitest configuration for Node-based test execution.
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['src/**/*.spec.ts'],
        fileParallelism: false,
        clearMocks: true,
        // Disable lemon-core SNS error reporting in tests; without AWS creds, SNS publish hangs and causes timeouts.
        env: {
            REPORT_ERROR: '0',
        },
        coverage: {
            enabled: true,
            provider: 'v8',
            reporter: ['text', 'html'],
            reportsDirectory: 'coverage',
        },
    },
});
