import nextEnv from '@next/env';

// Match Next.js environment loading before importing the configured model.
nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');
const { suggestTheme, themeModel } = await import('../lib/theme-generator.js');

try {
  const theme = await suggestTheme();
  console.log(JSON.stringify(theme, null, 2));
} catch (error) {
  console.error(`AI theme check failed (${themeModel}): ${error.message}`);
  process.exitCode = 1;
}
