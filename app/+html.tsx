// app/+html.tsx - Custom HTML document for Expo Router
import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

/**
 * This file is web-only and used to configure the root HTML for every web page during static rendering.
 * The contents of this function only run in Node.js environments and do not have access to the DOM or browser APIs.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        
        {/* Aggressive cache-busting meta tags */}
        <meta httpEquiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
        <meta httpEquiv="Pragma" content="no-cache" />
        <meta httpEquiv="Expires" content="0" />
        
        {/* Prevent Cloudflare and other CDNs from caching */}
        <meta httpEquiv="Surrogate-Control" content="no-store" />
        
        {/* Cache-busting script for auto-login scenarios */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              // Prevent browser back/forward cache (bfcache) - critical for auto-login
              (function() {
                // Force reload if page was loaded from cache
                window.addEventListener('pageshow', function(event) {
                  if (event.persisted) {
                    // Page was loaded from bfcache - force hard reload to get fresh HTML
                    window.location.reload();
                  }
                });
                
                // Add cache-busting query param if missing (helps with Cloudflare)
                if (window.location.search.indexOf('_cb=') === -1) {
                  const url = new URL(window.location.href);
                  url.searchParams.set('_cb', Date.now().toString());
                  // Only update if we're not in the middle of Auth0 redirect
                  if (!url.searchParams.has('code') && !url.searchParams.has('state')) {
                    window.history.replaceState({}, '', url.toString());
                  }
                }
              })();
            `,
          }}
        />
        
        <ScrollViewStyleReset />
        
        {/* Using raw CSS styles as a workaround for the View component. */}
        <style dangerouslySetInnerHTML={{ __html: responsiveBackground }} />
        <meta name="expo-web-output" content="static" />
      </head>
      <body>{children}</body>
    </html>
  );
}

const responsiveBackground = `
body {
  background-color: #fff;
}
@media (prefers-color-scheme: dark) {
  body {
    background-color: #000;
  }
}
`;

