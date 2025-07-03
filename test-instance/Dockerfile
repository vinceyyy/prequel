# Use the official code-server image as base - it already has Node.js, Python, and many tools
FROM codercom/code-server:4.99.3

# Switch to root to install additional packages
USER root

# Create workspace directories for each scenario
RUN mkdir -p /workspaces/javascript /workspaces/python /workspaces/sql /workspaces/fullstack

# Copy scenario files (from parent context)
COPY scenario/javascript/ /workspaces/javascript/
COPY scenario/python/ /workspaces/python/
COPY scenario/sql/ /workspaces/sql/
COPY scenario/fullstack/ /workspaces/fullstack/

# Note: Dependencies will be installed at runtime to avoid build-time network issues
# The scenarios are copied and can be installed when the container starts

# Set proper ownership
RUN chown -R coder:coder /workspaces

# Add startup script
COPY instance/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Switch to coder user and set workspace
USER coder
WORKDIR /workspaces

# Expose code-server port
EXPOSE 8443

# Start code-server
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]