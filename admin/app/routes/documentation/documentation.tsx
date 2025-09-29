import { useParams } from 'react-router';
import { useEffect, useState } from 'react';
import Title from '~/components/shared/title/title';
import ContentBlock from '~/components/shared/content-block/content-block';
import PageLayoutNav from '~/components/shared/layout/page-layout-nav';
import NavLink from '~/components/shared/nav/nav-link';
import appConfig from '~/config/config.json';
import { requireAuthMiddleware } from '~/utils/auth-middleware';

export async function loader({ request }: { request: Request }) {
  await requireAuthMiddleware(request);

  return null;
}

export function meta() {
  return [
    { title: 'Documentation' },
    { name: 'description', content: 'Apt Mirror Documentation' },
  ];
}

const sections = [
  { id: 'file-structure', linkName: 'File Structure', title: 'File Structure' },
  { id: 'commands', linkName: 'Commands', title: 'Commands' },
  ...(appConfig.isNpmProxyEnabled
    ? [
        {
          id: 'npm-proxy',
          linkName: 'NPM Proxy',
          title: 'NPM Proxy Configuration',
        },
      ]
    : []),
];

export default function Documentation() {
  const [activeSection, setActiveSection] = useState<string>('file-structure');
  const { section } = useParams();

  useEffect(() => {
    if (section) {
      setActiveSection(section);
    }
  }, [section]);

  const renderFileStructure = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-4">Data Directory Structure</h3>
        <div className="bg-gray-50 p-4 rounded-lg font-mono text-sm">
          <pre className="whitespace-pre-wrap">
            {`data/
├── conf/
│   ├── apt-mirror/
│   │   └── mirror.list          # apt-mirror2 configuration
│   └── nginx/
│       ├── .htpasswd            # Admin authentication file
│       └── sites-available/     # Nginx site configurations
│           ├── mirror.intra.conf
│           ├── admin.mirror.intra.conf
│           ├── files.mirror.intra.conf${
              appConfig.isNpmProxyEnabled
                ? `
│           └── npm.mirror.intra.conf`
                : ''
            }
├── data/
│   ├── apt-mirror/              # apt-mirror2 working directory
│   │   ├── mirror/              # Downloaded package mirrors
│   │   ├── skel/                # Skeleton files
│   │   └── var/                 # Variable data
│   ├── files/                   # Custom file repository${
              appConfig.isNpmProxyEnabled
                ? `
│   └── npm/                     # NPM package cache`
                : ''
            }
└── logs/
    ├── apt-mirror/              # apt-mirror2 logs
    │   └── apt-mirror.log       # Main apt-mirror2 log file
    └── nginx/                   # Nginx access and error logs`}
          </pre>
        </div>
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-4">Description</h3>
        <div className="space-y-4">
          <div>
            <h4 className="font-semibold text-sky-500">conf/</h4>
            <p className="text-gray-700">
              Configuration files for apt-mirror and nginx. Contains mirror
              settings, authentication, and web server configurations.
            </p>
          </div>
          <div>
            <h4 className="font-semibold text-sky-500">data/</h4>
            <p className="text-gray-700">
              Main data storage directory. apt-mirror/ contains downloaded
              package repositories, files/ contains custom file repository
              {appConfig.isNpmProxyEnabled
                ? ', npm/ contains cached npm packages'
                : ''}
              .
            </p>
          </div>
          <div>
            <h4 className="font-semibold text-sky-500">logs/</h4>
            <p className="text-gray-700">
              Log files from apt-mirror synchronization and nginx web server
              operations.
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  const renderCommands = () => (
    <div className="space-y-8">
      <div>
        <h3 className="text-lg font-semibold mb-4">Build Process</h3>
        <div className="bg-gray-50 p-4 rounded-lg">
          <h4 className="font-semibold text-sky-500 mb-2">./build.sh</h4>
          <p className="text-gray-700 mb-3">
            Builds Docker images for multiple architectures (amd64, arm64).
          </p>
          <div className="bg-white p-3 rounded border-l-4 border-sky-300">
            <h5 className="font-semibold mb-2">Operations:</h5>
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li>Checks Docker and buildx prerequisites</li>
              <li>Sets up multi-platform builder</li>
              <li>Builds images for both amd64 and arm64 architectures</li>
              <li>Saves compressed tar files to dist/ directory</li>
              <li>
                Installs required packages: apt-mirror, nginx, openssl, curl,
                wget, xz-utils, nodejs, npm
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-4">Initial Setup</h3>
        <div className="bg-gray-50 p-4 rounded-lg">
          <h4 className="font-semibold text-sky-500 mb-2">./setup.sh</h4>
          <p className="text-gray-700 mb-3">
            Performs initial deployment and configuration of the apt-mirror
            container.
          </p>
          <div className="bg-white p-3 rounded border-l-4 border-emerald-300">
            <h5 className="font-semibold mb-2">Operations:</h5>
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li>Detects system architecture (amd64/arm64)</li>
              <li>Validates required image files exist in dist/</li>
              <li>
                Prompts for custom configuration (domain, sync frequency, admin
                password)
              </li>
              <li>Generates nginx htpasswd file for authentication</li>
              <li>Cleans up previous installations</li>
              <li>Creates data directories structure</li>
              <li>Generates apt-mirror configuration</li>
              <li>Creates docker-compose.yml from template</li>
              <li>Calls start.sh to load image and start container</li>
            </ul>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-4">Starting and Restarting</h3>
        <div className="bg-gray-50 p-4 rounded-lg">
          <h4 className="font-semibold text-sky-500 mb-2">./start.sh</h4>
          <p className="text-gray-700 mb-3">
            Loads Docker image and starts the container. Used by setup.sh and
            for manual restarts.
          </p>
          <div className="bg-white p-3 rounded border-l-4 border-sky-300">
            <h5 className="font-semibold mb-2">Operations:</h5>
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li>Detects system architecture (amd64/arm64)</li>
              <li>Validates required image files exist in dist/</li>
              <li>Loads appropriate Docker image</li>
              <li>Starts the container using docker-compose</li>
            </ul>
          </div>

          <h4 className="font-semibold text-sky-500 mb-2 mt-4">
            After Initial Setup
          </h4>
          <p className="text-gray-700 mb-3">
            Commands for managing the running container.
          </p>
          <div className="bg-white p-3 rounded border-l-4 border-amber-300">
            <h5 className="font-semibold mb-2">Operations:</h5>
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li>
                <code className="bg-gray-100 px-1 rounded">./start.sh</code> -
                Load image and start container
              </li>
              <li>
                <code className="bg-gray-100 px-1 rounded">
                  docker compose up -d
                </code>{' '}
                - Start container
              </li>
              <li>
                <code className="bg-gray-100 px-1 rounded">
                  docker compose down
                </code>{' '}
                - Stop container
              </li>
              <li>
                <code className="bg-gray-100 px-1 rounded">
                  docker compose restart
                </code>{' '}
                - Restart container
              </li>
              <li>
                <code className="bg-gray-100 px-1 rounded">
                  docker logs ui-apt-mirror
                </code>{' '}
                - View container logs
              </li>
              <li>
                <code className="bg-gray-100 px-1 rounded">
                  docker compose logs
                </code>{' '}
                - View compose logs
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-4">
          Upgrading the Installation
        </h3>
        <div className="bg-gray-50 p-4 rounded-lg">
          <h4 className="font-semibold text-sky-500 mb-2">./upgrade.sh</h4>
          <p className="text-gray-700 mb-3">
            Downloads and installs the latest version from the official website.
          </p>
          <div className="bg-white p-3 rounded border-l-4 border-violet-300">
            <h5 className="font-semibold mb-2">Operations:</h5>
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li>
                Checks connectivity to https://ui-apt-mirror.dbashkatov.com/
              </li>
              <li>Prompts user to choose architecture (current or all)</li>
              <li>Downloads latest version from official website</li>
              <li>Extracts archive to temporary directory</li>
              <li>Installs new image files to dist/ directory</li>
              <li>Runs setup.sh to deploy the upgrade</li>
              <li>Cleans up temporary files</li>
            </ul>
          </div>
          <div className="bg-amber-50 p-3 rounded border-l-4 border-amber-300 mt-3">
            <h5 className="font-semibold mb-2">Prerequisites:</h5>
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li>Internet connection</li>
              <li>curl for downloading</li>
              <li>tar for extraction</li>
              <li>setup.sh in current directory</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );

  const renderNpmProxy = () => {
    if (!appConfig.isNpmProxyEnabled) {
      return null;
    }

    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold mb-4">NPM Proxy Overview</h3>
          <div className="bg-gray-50 p-4 rounded-lg">
            <p className="text-gray-700 mb-3">
              The NPM Proxy provides a local caching layer for npm packages,
              speeding up installations and reducing bandwidth usage. It acts as
              a transparent proxy to the official npm registry.
            </p>
            <div className="bg-white p-3 rounded border-l-4 border-blue-300">
              <h5 className="font-semibold mb-2">Features:</h5>
              <ul className="list-disc list-inside space-y-1 text-sm">
                <li>Transparent caching of npm packages</li>
                <li>Automatic package metadata fetching</li>
                <li>Bandwidth optimization for repeated installs</li>
                <li>Offline package availability</li>
              </ul>
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-lg font-semibold mb-4">Usage</h3>
          <div className="bg-gray-50 p-4 rounded-lg">
            <h4 className="font-semibold text-sky-500 mb-2">
              Configure npm to use the proxy
            </h4>
            <div className="bg-white p-3 rounded border-l-4 border-amber-300">
              <h5 className="font-semibold mb-2">Commands:</h5>
              <div className="space-y-2 text-sm font-mono">
                <div className="bg-gray-100 p-2 rounded">
                  npm config set registry http://npm.mirror.intra
                </div>
                <div className="bg-gray-100 p-2 rounded">
                  npm config set registry http://npm.yourdomain.com
                </div>
              </div>
            </div>

            <h4 className="font-semibold text-sky-500 mb-2 mt-4">
              Verify Configuration
            </h4>
            <div className="bg-white p-3 rounded border-l-4 border-purple-300">
              <h5 className="font-semibold mb-2">Test Commands:</h5>
              <div className="space-y-2 text-sm font-mono">
                <div className="bg-gray-100 p-2 rounded">npm view react</div>
                <div className="bg-gray-100 p-2 rounded">npm install react</div>
                <div className="bg-gray-100 p-2 rounded">
                  curl http://npm.mirror.intra/react
                </div>
              </div>
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-lg font-semibold mb-4">File Management</h3>
          <div className="bg-gray-50 p-4 rounded-lg">
            <p className="text-gray-700 mb-3">
              Cached npm packages are stored in the data/npm/ directory and can
              be viewed and managed through the File Manager in the admin
              interface.
            </p>
            <div className="bg-white p-3 rounded border-l-4 border-indigo-300">
              <h5 className="font-semibold mb-2">Access:</h5>
              <ul className="list-disc list-inside space-y-1 text-sm">
                <li>Admin UI → File Manager → NPM Packages view</li>
                <li>Browse cached packages by name</li>
                <li>View package metadata and tarballs</li>
                <li>Monitor cache usage and growth</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <PageLayoutNav
      nav={sections.map((section) => (
        <NavLink
          key={section.id}
          to={`/documentation/${section.id}`}
          isActive={activeSection === section.id}
        >
          {section.linkName}
        </NavLink>
      ))}
    >
      <>
        <div className="lg:-translate-x-[132px]">
          <Title
            title={
              sections.find((section) => section.id === activeSection)?.title ??
              'Documentation'
            }
          />
        </div>
        <ContentBlock className="flex-1">
          {activeSection === 'file-structure' && renderFileStructure()}
          {activeSection === 'commands' && renderCommands()}
          {activeSection === 'npm-proxy' &&
            appConfig.isNpmProxyEnabled &&
            renderNpmProxy()}
        </ContentBlock>
      </>
    </PageLayoutNav>
  );
}
