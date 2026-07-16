import path from 'node:path';

const pluginDir = process.cwd();
const localesDir = path.join(pluginDir, 'locales');

export default {
  lexers: {
    default: ['JsxLexer'],
  },
  namespaceSeparator: '|',
  keySeparator: false,
  output: path.join(localesDir, '$LOCALE/$NAMESPACE.json'),
  locales: ['en'],
  contextSeparator: '//context:',
  defaultValue: (locale, _namespace, key) => {
    if (locale !== 'en') {
      return '';
    }
    const contextSeparatorIndex = key.indexOf('//context:');
    return contextSeparatorIndex >= 0 ? key.substring(0, contextSeparatorIndex) : key;
  },
};
