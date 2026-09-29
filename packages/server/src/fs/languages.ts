/**
 * File name -> language. `name` is the display name used in overviews ("TypeScript", "C/C++");
 * `id` is a lower-case identifier for syntax highlighting and code fences ("typescript", "cpp").
 */
import { extname } from 'node:path';

export interface LanguageInfo {
  id: string;
  name: string;
}

const L = (id: string, name: string): LanguageInfo => ({ id, name });

const TYPESCRIPT = L('typescript', 'TypeScript');
const JAVASCRIPT = L('javascript', 'JavaScript');
const PYTHON = L('python', 'Python');
const RUBY = L('ruby', 'Ruby');
const SHELL = L('shell', 'Shell');
const DOCKERFILE = L('dockerfile', 'Dockerfile');
const MAKEFILE = L('makefile', 'Makefile');
const CMAKE = L('cmake', 'CMake');
const GROOVY = L('groovy', 'Groovy');
const C = L('c', 'C/C++');
const CPP = L('cpp', 'C/C++');

const BY_EXTENSION: Record<string, LanguageInfo> = {
  '.ts': TYPESCRIPT,
  '.tsx': TYPESCRIPT,
  '.mts': TYPESCRIPT,
  '.cts': TYPESCRIPT,
  '.js': JAVASCRIPT,
  '.jsx': JAVASCRIPT,
  '.mjs': JAVASCRIPT,
  '.cjs': JAVASCRIPT,
  '.py': PYTHON,
  '.pyi': PYTHON,
  '.pyw': PYTHON,
  '.ipynb': L('json', 'Jupyter Notebook'),
  '.go': L('go', 'Go'),
  '.rs': L('rust', 'Rust'),
  '.java': L('java', 'Java'),
  '.kt': L('kotlin', 'Kotlin'),
  '.kts': L('kotlin', 'Kotlin'),
  '.scala': L('scala', 'Scala'),
  '.sc': L('scala', 'Scala'),
  '.groovy': GROOVY,
  '.gradle': GROOVY,
  '.clj': L('clojure', 'Clojure'),
  '.cljs': L('clojure', 'Clojure'),
  '.cljc': L('clojure', 'Clojure'),
  '.cs': L('csharp', 'C#'),
  '.csx': L('csharp', 'C#'),
  '.fs': L('fsharp', 'F#'),
  '.fsx': L('fsharp', 'F#'),
  '.vb': L('vb', 'Visual Basic'),
  '.c': C,
  '.h': C,
  '.cc': CPP,
  '.cpp': CPP,
  '.cxx': CPP,
  '.c++': CPP,
  '.hh': CPP,
  '.hpp': CPP,
  '.hxx': CPP,
  '.ino': CPP,
  '.m': L('objectivec', 'Objective-C'),
  '.mm': L('objectivec', 'Objective-C'),
  '.swift': L('swift', 'Swift'),
  '.dart': L('dart', 'Dart'),
  '.rb': RUBY,
  '.erb': RUBY,
  '.rake': RUBY,
  '.gemspec': RUBY,
  '.php': L('php', 'PHP'),
  '.ex': L('elixir', 'Elixir'),
  '.exs': L('elixir', 'Elixir'),
  '.erl': L('erlang', 'Erlang'),
  '.hrl': L('erlang', 'Erlang'),
  '.hs': L('haskell', 'Haskell'),
  '.ml': L('ocaml', 'OCaml'),
  '.mli': L('ocaml', 'OCaml'),
  '.elm': L('elm', 'Elm'),
  '.lua': L('lua', 'Lua'),
  '.r': L('r', 'R'),
  '.jl': L('julia', 'Julia'),
  '.pl': L('perl', 'Perl'),
  '.pm': L('perl', 'Perl'),
  '.zig': L('zig', 'Zig'),
  '.nim': L('nim', 'Nim'),
  '.sol': L('solidity', 'Solidity'),
  '.sh': SHELL,
  '.bash': SHELL,
  '.zsh': SHELL,
  '.fish': SHELL,
  '.ps1': L('powershell', 'PowerShell'),
  '.psm1': L('powershell', 'PowerShell'),
  '.bat': L('batch', 'Batch'),
  '.cmd': L('batch', 'Batch'),
  '.sql': L('sql', 'SQL'),
  '.html': L('html', 'HTML'),
  '.htm': L('html', 'HTML'),
  '.css': L('css', 'CSS'),
  '.scss': L('scss', 'SCSS'),
  '.sass': L('sass', 'Sass'),
  '.less': L('less', 'Less'),
  '.vue': L('vue', 'Vue'),
  '.svelte': L('svelte', 'Svelte'),
  '.astro': L('astro', 'Astro'),
  '.json': L('json', 'JSON'),
  '.jsonc': L('json', 'JSON'),
  '.json5': L('json', 'JSON'),
  '.yml': L('yaml', 'YAML'),
  '.yaml': L('yaml', 'YAML'),
  '.toml': L('toml', 'TOML'),
  '.xml': L('xml', 'XML'),
  '.xsd': L('xml', 'XML'),
  '.xsl': L('xml', 'XML'),
  '.plist': L('xml', 'XML'),
  '.ini': L('ini', 'INI'),
  '.cfg': L('ini', 'INI'),
  '.properties': L('properties', 'Properties'),
  '.md': L('markdown', 'Markdown'),
  '.mdx': L('markdown', 'Markdown'),
  '.markdown': L('markdown', 'Markdown'),
  '.rst': L('rst', 'reStructuredText'),
  '.tex': L('latex', 'TeX'),
  '.proto': L('protobuf', 'Protocol Buffers'),
  '.graphql': L('graphql', 'GraphQL'),
  '.gql': L('graphql', 'GraphQL'),
  '.tf': L('hcl', 'HCL'),
  '.tfvars': L('hcl', 'HCL'),
  '.hcl': L('hcl', 'HCL'),
  '.cmake': CMAKE,
  '.mk': MAKEFILE,
  '.dockerfile': DOCKERFILE,
};

const BY_NAME: Record<string, LanguageInfo> = {
  dockerfile: DOCKERFILE,
  containerfile: DOCKERFILE,
  makefile: MAKEFILE,
  gnumakefile: MAKEFILE,
  'cmakelists.txt': CMAKE,
  gemfile: RUBY,
  rakefile: RUBY,
  podfile: RUBY,
  vagrantfile: RUBY,
  brewfile: RUBY,
  jenkinsfile: GROOVY,
  '.bashrc': SHELL,
  '.zshrc': SHELL,
  '.profile': SHELL,
  'go.mod': L('go', 'Go'),
  'go.sum': L('go', 'Go'),
};

/** Best-effort language of a file, from its name. */
export function detectLanguage(fileName: string): LanguageInfo | undefined {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const lower = base.toLowerCase();
  const byName = BY_NAME[lower];
  if (byName) return byName;
  if (lower.startsWith('dockerfile.') || lower.endsWith('.dockerfile')) return DOCKERFILE;
  if (lower.startsWith('makefile.')) return MAKEFILE;
  return BY_EXTENSION[extname(lower)];
}

/** Display name for overviews ("TypeScript"). */
export function languageName(fileName: string): string | undefined {
  return detectLanguage(fileName)?.name;
}

/** Identifier for highlighting / code fences ("typescript"). */
export function languageId(fileName: string): string | undefined {
  return detectLanguage(fileName)?.id;
}
