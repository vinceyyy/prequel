# Use the official code-server image as base - it already has Node.js and basic tools
FROM codercom/code-server:4.99.3

# Switch to root to install additional packages
USER root

# Install Python3, pip, Node.js, and AWS CLI (optimized for smaller size)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        python3 python-is-python3 python3-pip python3-venv nodejs npm curl unzip && \
    curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" && \
    unzip awscliv2.zip && \
    ./aws/install && \
    rm -rf awscliv2.zip aws && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* && \
    find /usr/share/doc -depth -type f ! -name copyright | xargs rm || true && \
    find /usr/share/man -depth -type f | xargs rm || true

# Install uv
RUN curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR="/usr/local/bin" sh

# Install AI assistances
RUN npm install -g @openai/codex
RUN npm install -g @anthropic-ai/claude-code

# Create workspace directory (challenge will be downloaded at runtime)
RUN mkdir -p /workspaces

# Set proper ownership
RUN chown -R coder:coder /workspaces

# Add startup script
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Switch to coder user and set workspace
USER coder
WORKDIR /workspaces

# Install common VS Code extensions that work well with our challenges
RUN code-server --install-extension ms-python.python \
    && code-server --install-extension ms-toolsai.jupyter \
    && code-server --install-extension ms-vscode.vscode-typescript-next \
    && code-server --install-extension dbcode.dbcode \
    && code-server --install-extension wayou.vscode-todo-highlight

# Copy user settings with proper ownership
COPY --chown=coder:coder settings.json /home/coder/.local/share/code-server/User/settings.json

# Expose code-server port
EXPOSE 8443

# Start code-server
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]