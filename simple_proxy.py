#!/usr/bin/env python3
"""
Simple reverse proxy to make the WebGPU + YOLO application accessible at port 8080
"""

import http.server
import socketserver
import urllib.request
import urllib.parse
import urllib.error
from http.server import BaseHTTPRequestHandler
import json
import sys
from urllib.parse import urlparse, urljoin

class ProxyHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        # Parse the requested path
        parsed_path = urlparse(self.path)
        path = parsed_path.path
        query = parsed_path.query
        
        # Determine if this is a request for the frontend or backend
        if path.startswith('/api/') or path.startswith('/ws/'):
            # Backend API request
            backend_url = f"http://localhost:3001{self.path}"
            self.proxy_request(backend_url)
        elif path.startswith('/js/') or path.startswith('/css/') or path.startswith('/assets/'):
            # Static assets - forward to frontend
            frontend_url = f"http://[::1]:5173{self.path}"
            self.proxy_request(frontend_url)
        elif path == '/' or path.endswith('.html') or path == '/favicon.ico':
            # Main page and static resources - forward to frontend
            frontend_url = f"http://[::1]:5173{self.path}"
            self.proxy_request(frontend_url)
        else:
            # Default to frontend for other requests
            frontend_url = f"http://[::1]:5173{self.path}"
            self.proxy_request(frontend_url)
    
    def do_POST(self):
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length)
        
        # Determine destination based on path
        if self.path.startswith('/api/'):
            backend_url = f"http://localhost:3001{self.path}"
            self.proxy_post_request(backend_url, post_data)
        else:
            frontend_url = f"http://[::1]:5173{self.path}"
            self.proxy_post_request(frontend_url, post_data)
    
    def proxy_request(self, target_url):
        try:
            req = urllib.request.Request(target_url)
            # Forward headers
            for header, value in self.headers.items():
                if header.lower() not in ['host', 'connection']:
                    req.add_header(header, value)
            
            response = urllib.request.urlopen(req, timeout=30)
            
            # Send response back to client
            self.send_response(response.getcode())
            for header, value in response.headers.items():
                if header.lower() != 'transfer-encoding':  # Avoid conflicts
                    self.send_header(header, value)
            self.end_headers()
            
            # Copy response body
            self.copyfile(response, self.wfile)
            
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self.end_headers()
            if e.fp:
                self.copyfile(e.fp, self.wfile)
        except urllib.error.URLError as e:
            self.send_error(502, f"Bad Gateway: {str(e)}")
        except Exception as e:
            self.send_error(500, f"Internal Server Error: {str(e)}")
    
    def proxy_post_request(self, target_url, data):
        try:
            req = urllib.request.Request(target_url, data=data, method='POST')
            # Forward headers
            for header, value in self.headers.items():
                if header.lower() not in ['host', 'content-length', 'connection']:
                    req.add_header(header, value)
            
            response = urllib.request.urlopen(req, timeout=30)
            
            # Send response back to client
            self.send_response(response.getcode())
            for header, value in response.headers.items():
                if header.lower() != 'transfer-encoding':  # Avoid conflicts
                    self.send_header(header, value)
            self.end_headers()
            
            # Copy response body
            self.copyfile(response, self.wfile)
            
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self.end_headers()
            if e.fp:
                self.copyfile(e.fp, self.wfile)
        except urllib.error.URLError as e:
            self.send_error(502, f"Bad Gateway: {str(e)}")
        except Exception as e:
            self.send_error(500, f"Internal Server Error: {str(e)}")

def main():
    PORT = 8080
    
    print(f"Starting proxy server on port {PORT}")
    print("Forwarding frontend requests to http://[::1]:5173")
    print("Forwarding backend requests to http://localhost:3001")
    print("Press Ctrl+C to stop the server")
    
    try:
        with socketserver.TCPServer(("", PORT), ProxyHandler) as httpd:
            print(f"Proxy server running at http://localhost:{PORT}/")
            httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down proxy server...")
        sys.exit(0)

if __name__ == "__main__":
    main()