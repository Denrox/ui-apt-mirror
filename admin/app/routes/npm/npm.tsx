import type { LoaderFunctionArgs, ActionFunctionArgs } from 'react-router';
import { promises as fs } from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { URL } from 'url';
import zlib from 'zlib';

const NPM_REGISTRY_URL = 'https://registry.npmjs.org';

// Ensure cache directory exists
async function ensureCacheDir() {
  try {
    await fs.mkdir('/var/www/npm', { recursive: true });
  } catch (error) {
    console.error('Failed to create cache directory:', error);
  }
}

// Generate cache file path from package path
function getCachePath(packagePath: string): string {
  // Clean the package path
  const cleanPath = packagePath.replace(/^\/+/, '').replace(/\/+$/, '');
  const cachePath = path.join('/var/www/npm', cleanPath);
  
  // Ensure directory exists for nested packages
  const dir = path.dirname(cachePath);
  fs.mkdir(dir, { recursive: true }).catch(console.error);
  
  return cachePath;
}

// Check if file exists in cache
async function isCached(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Fetch from npm registry
async function fetchFromNpm(packagePath: string, originalHeaders: Record<string, string> = {}): Promise<{ data: Buffer; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const npmUrl = new URL(packagePath, NPM_REGISTRY_URL);
    const client = npmUrl.protocol === 'https:' ? https : http;
    
    // Forward important headers from the original request
    const forwardedHeaders: Record<string, string> = {
      'User-Agent': 'npm-cache-proxy/1.0',
      'Accept': '*/*',
    };
    
    // Forward authentication and authorization headers
    const authHeaders = ['authorization', 'x-npm-auth-token', 'x-npm-session', 'x-npm-auth-type'];
    for (const header of authHeaders) {
      if (originalHeaders[header]) {
        forwardedHeaders[header] = originalHeaders[header];
      }
    }
    
    // Forward other relevant headers (but not accept-encoding to avoid compression)
    const otherHeaders = ['if-none-match', 'if-modified-since', 'range'];
    for (const header of otherHeaders) {
      if (originalHeaders[header]) {
        forwardedHeaders[header] = originalHeaders[header];
      }
    }
    
    const options = {
      hostname: npmUrl.hostname,
      port: npmUrl.port || (npmUrl.protocol === 'https:' ? 443 : 80),
      path: npmUrl.pathname + npmUrl.search,
      method: 'GET',
      headers: forwardedHeaders,
    };


    const req = client.request(options, (res) => {
      
      const chunks: Buffer[] = [];
      
      res.on('data', (chunk) => {
        chunks.push(chunk);
      });
      
            res.on('end', () => {
              let data = Buffer.concat(chunks);
              const headers: Record<string, string> = {};


              // Handle decompression if needed
              const contentEncoding = res.headers['content-encoding'];
              if (contentEncoding === 'gzip') {
                try {
                  data = Buffer.from(zlib.gunzipSync(data));
                } catch (error) {
                  // Decompression failed, continue with original data
                }
              } else if (contentEncoding === 'deflate') {
                try {
                  data = Buffer.from(zlib.inflateSync(data));
                } catch (error) {
                  // Decompression failed, continue with original data
                }
              }

              // Copy relevant headers (excluding compression-related ones)
              const relevantHeaders = [
                'content-type', 'etag', 'last-modified',
                'cache-control', 'expires', 'age'
              ];

              for (const header of relevantHeaders) {
                const value = res.headers[header];
                if (value) {
                  headers[header] = Array.isArray(value) ? value[0] : value;
                }
              }

              // Update content-length to reflect decompressed size
              headers['content-length'] = data.length.toString();

              resolve({ data, headers });
            });
    });
    
    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    
    req.end();
  });
}

// Save to cache
async function saveToCache(filePath: string, data: Buffer, headers: Record<string, string>) {
  try {
    // Save the actual file
    await fs.writeFile(filePath, data);
    
    // Save metadata
    const metaPath = filePath + '.meta';
    await fs.writeFile(metaPath, JSON.stringify({
      headers,
      cachedAt: new Date().toISOString(),
      size: data.length
    }, null, 2));
    
  } catch (error) {
    console.error('Failed to save to cache:', error);
  }
}

// Load from cache
async function loadFromCache(filePath: string): Promise<{ data: Buffer; headers: Record<string, string> }> {
  try {
    const data = await fs.readFile(filePath);
    
    // Try to load metadata
    let headers: Record<string, string> = {};
    try {
      const metaPath = filePath + '.meta';
      const metaData = await fs.readFile(metaPath, 'utf-8');
      const meta = JSON.parse(metaData);
      headers = meta.headers || {};
      
      // Add cache-specific headers
      headers['x-cache'] = 'HIT';
      headers['x-cached-at'] = meta.cachedAt;
    } catch {
      // No metadata, use defaults
      headers['x-cache'] = 'HIT';
    }
    
    return { data, headers };
  } catch (error) {
    throw new Error('Failed to load from cache');
  }
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  // Extract the path from the request URL
  const url = new URL(request.url);
  let packagePath = url.pathname;
  
  // Remove /npm prefix if present
  if (packagePath.startsWith('/npm/')) {
    packagePath = packagePath.substring(5); // Remove '/npm/'
  } else if (packagePath.startsWith('/npm')) {
    packagePath = packagePath.substring(4); // Remove '/npm'
  }
  
  // Remove leading slash
  packagePath = packagePath.replace(/^\/+/, '');
  
  if (!packagePath) {
    return new Response('Not Found', { 
      status: 404,
      headers: {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*',
      }
    });
  }
  
  // Handle OPTIONS preflight requests
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, HEAD',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, X-NPM-Auth-Token, X-NPM-Session, X-NPM-OTP',
        'Access-Control-Max-Age': '86400',
      }
    });
  }
  
  // Extract headers from the original request
  const originalHeaders: Record<string, string> = {};
  for (const [key, value] of request.headers.entries()) {
    originalHeaders[key.toLowerCase()] = value;
  }
  
  
  try {
    await ensureCacheDir();
    
    const cachePath = getCachePath(packagePath);
    const isPackageCached = await isCached(cachePath);
    
    let data: Buffer;
    let headers: Record<string, string>;
    
    if (isPackageCached) {
      // Serve from cache
      const cached = await loadFromCache(cachePath);
      data = cached.data;
      headers = cached.headers;
    } else {
      // Fetch from npm and cache
      const fetched = await fetchFromNpm(packagePath, originalHeaders);
      data = fetched.data;
      headers = fetched.headers;
      
      // Save to cache
      await saveToCache(cachePath, data, headers);
      
      // Add cache headers
      headers['x-cache'] = 'MISS';
    }
    
    // Determine content type
    const contentType = headers['content-type'] || 'application/octet-stream';
    
    // Create response headers, avoiding duplicates
    const responseHeaders: Record<string, string> = {
      'Content-Type': contentType,
      'Content-Length': data.length.toString(),
      'X-Cache': headers['x-cache'] || 'UNKNOWN',
      'X-Cached-At': headers['x-cached-at'] || '',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, HEAD',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    };
    
    // Add other headers from upstream, excluding ones we've already set
    const excludeHeaders = ['content-type', 'content-length', 'x-cache', 'x-cached-at'];
    for (const [key, value] of Object.entries(headers)) {
      if (!excludeHeaders.includes(key.toLowerCase())) {
        responseHeaders[key] = value;
      }
    }
    
    // Create response
    const response = new Response(new Uint8Array(data), {
      status: 200,
      headers: responseHeaders,
    });
    
    return response;
    
  } catch (error) {
    console.error('NPM proxy error:', error);
    return new Response('Internal Server Error', { 
      status: 500,
      headers: {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*',
      }
    });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  // Handle POST requests (npm publish, etc.)
  const url = new URL(request.url);
  let packagePath = url.pathname;
  
  // Remove /npm prefix if present
  if (packagePath.startsWith('/npm/')) {
    packagePath = packagePath.substring(5); // Remove '/npm/'
  } else if (packagePath.startsWith('/npm')) {
    packagePath = packagePath.substring(4); // Remove '/npm'
  }
  
  // Remove leading slash
  packagePath = packagePath.replace(/^\/+/, '');
  
  if (!packagePath) {
    return new Response('Not Found', { 
      status: 404,
      headers: {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*',
      }
    });
  }
  
  // Handle OPTIONS preflight requests
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, HEAD',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, X-NPM-Auth-Token, X-NPM-Session, X-NPM-OTP',
        'Access-Control-Max-Age': '86400',
      }
    });
  }
  
  // Extract headers from the original request
  const originalHeaders: Record<string, string> = {};
  for (const [key, value] of request.headers.entries()) {
    originalHeaders[key.toLowerCase()] = value;
  }
  
  try {
    const npmUrl = new URL(packagePath, NPM_REGISTRY_URL);
    const client = npmUrl.protocol === 'https:' ? https : http;
    
    // Forward important headers from the original request
    const forwardedHeaders: Record<string, string> = {
      'User-Agent': 'npm-cache-proxy/1.0',
      'Content-Type': originalHeaders['content-type'] || 'application/json',
    };
    
    // Forward authentication and authorization headers
    const authHeaders = ['authorization', 'x-npm-auth-token', 'x-npm-session', 'x-npm-auth-type'];
    for (const header of authHeaders) {
      if (originalHeaders[header]) {
        forwardedHeaders[header] = originalHeaders[header];
      }
    }
    
    // Forward other relevant headers (but not accept-encoding to avoid compression)
    const otherHeaders = ['if-none-match', 'if-modified-since', 'range', 'content-length'];
    for (const header of otherHeaders) {
      if (originalHeaders[header]) {
        forwardedHeaders[header] = originalHeaders[header];
      }
    }
    
    const options = {
      hostname: npmUrl.hostname,
      port: npmUrl.port || (npmUrl.protocol === 'https:' ? 443 : 80),
      path: npmUrl.pathname + npmUrl.search,
      method: request.method,
      headers: forwardedHeaders,
    };
    
    return new Promise((resolve, reject) => {
      const req = client.request(options, (res) => {
        const chunks: Buffer[] = [];
        
        res.on('data', (chunk) => {
          chunks.push(chunk);
        });
        
        res.on('end', () => {
          let data = Buffer.concat(chunks);
          const responseHeaders: Record<string, string> = {};
          
          // Handle decompression if needed
          const contentEncoding = res.headers['content-encoding'];
          if (contentEncoding === 'gzip') {
            try {
              data = Buffer.from(zlib.gunzipSync(data));
            } catch (error) {
              console.error('Failed to decompress gzip data:', error);
            }
          } else if (contentEncoding === 'deflate') {
            try {
              data = Buffer.from(zlib.inflateSync(data));
            } catch (error) {
              console.error('Failed to decompress deflate data:', error);
            }
          }
          
          // Copy relevant headers from response (excluding compression-related ones)
          const relevantHeaders = [
            'content-type', 'etag', 'last-modified',
            'cache-control', 'expires', 'age', 'location'
          ];
          
          for (const header of relevantHeaders) {
            const value = res.headers[header];
            if (value) {
              responseHeaders[header] = Array.isArray(value) ? value[0] : value;
            }
          }
          
          // Update content-length to reflect decompressed size
          responseHeaders['content-length'] = data.length.toString();
          
          // Add CORS headers
          responseHeaders['Access-Control-Allow-Origin'] = '*';
          responseHeaders['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS, HEAD';
          responseHeaders['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Requested-With';
          
          const response = new Response(new Uint8Array(data), {
            status: res.statusCode || 200,
            headers: responseHeaders,
          });
          
          resolve(response);
        });
      });
      
      req.on('error', (error) => {
        console.error('NPM proxy POST error:', error);
        resolve(new Response('Internal Server Error', { 
          status: 500,
          headers: {
            'Content-Type': 'text/plain',
            'Access-Control-Allow-Origin': '*',
          }
        }));
      });
      
      req.setTimeout(30000, () => {
        req.destroy();
        resolve(new Response('Request timeout', { 
          status: 408,
          headers: {
            'Content-Type': 'text/plain',
            'Access-Control-Allow-Origin': '*',
          }
        }));
      });
      
      // Forward the request body
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        request.body?.pipeTo(new WritableStream({
          write(chunk) {
            req.write(chunk);
          },
          close() {
            req.end();
          }
        }));
      } else {
        req.end();
      }
    });
    
  } catch (error) {
    console.error('NPM proxy action error:', error);
    return new Response('Internal Server Error', { 
      status: 500,
      headers: {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*',
      }
    });
  }
}
