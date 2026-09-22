PORT ?= 8787
HOST ?= 127.0.0.1
URL  := http://$(HOST):$(PORT)/

.PHONY: run
.DEFAULT_GOAL := run

# Serve the scene and open it in Firefox once the server answers. The server runs in
# the foreground (Ctrl-C stops it); if one is already up on $(PORT), just open the page.
run: | node_modules
	@if curl -sf -o /dev/null $(URL); then \
		echo "Server already running on $(URL)"; \
		setsid -f firefox --new-tab $(URL) >/dev/null 2>&1; \
	else \
		( for i in $$(seq 50); do \
			curl -sf -o /dev/null $(URL) && exec setsid -f firefox --new-tab $(URL) >/dev/null 2>&1; \
			sleep 0.1; \
		done ) & \
		echo "Serving on $(URL) (Ctrl-C to stop)"; \
		exec python3 -m http.server $(PORT) --bind $(HOST); \
	fi

# three.js is loaded straight out of node_modules via the import map in index.html.
node_modules:
	npm install
