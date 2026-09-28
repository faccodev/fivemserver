from http.server import BaseHTTPRequestHandler, HTTPServer
import json

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        # Return a generic success response commonly expected by these scripts
        # Often they look for "true", "authorized", or a specific JSON structure.
        # "true" string is a common basic auth response in FiveM scripts.
        self.wfile.write(b"true") 
    
    def log_message(self, format, *args):
        # Override to print to stdout/stderr so it shows in docker logs
        print("%s - - [%s] %s" %
              (self.client_address[0],
               self.log_date_time_string(),
               format%args))

if __name__ == '__main__':
    server_address = ('', 8082)
    httpd = HTTPServer(server_address, Handler)
    print("Starting mock auth server on :8082")
    httpd.serve_forever()
