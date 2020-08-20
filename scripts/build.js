// build the package in the current working directory

process.env.NODE_ENV = 'production';

const {createHash} = require('crypto');
const readdirSync = require('fs').readdirSync;
const readFileSync = require('fs').readFileSync;
const unlinkSync = require('fs').unlinkSync;
const writeFileSync = require('fs').writeFileSync;
const resolve = require('path').resolve;
const dirname = require('path').dirname;
const {lsrSync} = require('lsr');
const babel = require('@babel/core');
const {sync: spawnSync} = require('cross-spawn');
const {existsSync} = require('fs');
const rimraf = require('rimraf').sync;
const mkdirp = require('mkdirp').sync;

const cwd = process.cwd();
const pkg = require(cwd + '/package.json');

// .last_build
const buildHash = createHash('sha512');
const IGNORED_NAMES = ['.cache', 'lib', 'node_modules', '.last_build'];
lsrSync(cwd, {
  filter(entry) {
    return !IGNORED_NAMES.includes(entry.name);
  },
}).forEach((entry) => {
  if (entry.isFile()) {
    buildHash.update(readFileSync(entry.path));
    buildHash.update(readFileSync(entry.fullPath));
  }
});

const packageNames = new Set(
  readdirSync(__dirname + '/../packages').map((dir) => {
    try {
      const src = readFileSync(
        __dirname + '/../packages/' + dir + '/package.json',
        'utf8',
      );
      return JSON.parse(src).name;
    } catch (ex) {
      if (ex.code !== 'ENOENT') throw ex;
    }
  }),
);
Object.keys(pkg.dependencies || {})
  .concat(Object.keys(pkg.devDependencies || {}))
  .sort()
  .filter((name) => packageNames.has(name))
  .forEach((name) => {
    buildHash.update(
      readFileSync(
        __dirname + '/../packages/' + name.split('/').pop() + '/.last_build',
      ),
    );
  });

const buildHashDigest = buildHash.digest('hex');
if (!process.argv.includes('--force')) {
  try {
    const lastBuild = readFileSync(cwd + '/.last_build', 'utf8');
    if (lastBuild.trim() === buildHashDigest) {
      process.exit(0);
    }
  } catch (ex) {
    if (ex.code !== 'ENOENT') {
      throw ex;
    }
  }
}

console.log('building ' + pkg.name);

lsrSync(cwd, {
  filter(entry) {
    return !IGNORED_NAMES.includes(entry.name);
  },
}).forEach((entry) => {
  if (!entry.isFile()) return;
  if (/\@autogenerated\b/.test(readFileSync(entry.fullPath, 'utf8'))) {
    unlinkSync(entry.fullPath);
  }
});

rimraf(cwd + '/lib');

// tsc -p tsconfig.build.json
const result = spawnSync(
  require.resolve('.bin/tsc'),
  ['-p', 'tsconfig.build.json', '--emitDeclarationOnly'],
  {
    stdio: 'inherit',
  },
);
if (result.status !== 0) {
  console.error('Failed to build ' + cwd.split('/').pop());
  process.exit(1);
}

if (existsSync(cwd + '/lib/eject')) {
  lsrSync(cwd + '/lib/eject').forEach((file) => {
    if (/\.d\.ts$/.test(file.path)) {
      rimraf(file.fullPath);
    }
  });
}
rimraf(cwd + '/lib/eject.d.ts');

const publicFilePaths = lsrSync(cwd + '/src')
  .map((entry) => {
    if (
      entry.isFile() &&
      (/\.jsx?$/.test(entry.path) || /\.json$/.test(entry.path))
    ) {
      mkdirp(dirname(resolve(cwd + '/lib/', entry.path)));
      writeFileSync(
        resolve(cwd + '/lib/', entry.path),
        readFileSync(entry.fullPath),
      );
    } else if (entry.isFile() && /\.ts?$/.test(entry.path)) {
      const mjsCode = babel.transformFileSync(entry.fullPath, {
        babelrc: false,
        presets: [
          require.resolve('@babel/preset-typescript'),
          // ES features necessary for user's Node version
          [
            require.resolve('@babel/preset-env'),
            {
              targets: {
                // update to track LTS releases
                node: '12.18.2',
              },
              bugfixes: true,
              modules: false,
              shippedProposals: true,
              exclude: ['@babel/plugin-transform-regenerator'],
            },
          ],
        ],
        plugins: [require.resolve('./babel-plugin-mjs')],
      }).code;
      const mjsPath = resolve(
        cwd + '/lib/',
        entry.path.replace(/\.ts$/, '.mjs'),
      );
      writeFileSync(mjsPath, mjsCode);
      writeFileSync(
        resolve(cwd + '/lib/', entry.path.replace(/\.ts$/, '.js')),
        babel.transformSync(mjsCode, {
          filename: mjsPath,
          babelrc: false,
          plugins: [require.resolve('./babel-plugin-raw-commonjs')],
        }).code,
      );
      if (/\.jsx$/.test(entry.fullPath)) {
        unlinkSync(entry.fullPath);
      }
    }
    return [];
  })
  .reduce((a, b) => [...a, ...b], []);
writeFileSync(cwd + '/.last_build', buildHashDigest);
