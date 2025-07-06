# Use the official code-server image as base - it already has Node.js and basic tools
FROM codercom/code-server:4.99.3

# Switch to root to install additional packages
USER root

# Install Python3, pip, Node.js, and AWS CLI
RUN apt-get update && \
    apt-get install -y python3 python3-pip python3-venv nodejs npm curl unzip && \
    curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" && \
    unzip awscliv2.zip && \
    ./aws/install && \
    rm -rf awscliv2.zip aws && \
    rm -rf /var/lib/apt/lists/*

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
    && code-server --install-extension ms-vscode.vscode-typescript-next \
    && code-server --install-extension esbenp.prettier-vscode \
    && code-server --install-extension bradlc.vscode-tailwindcss \
    && code-server --install-extension ms-toolsai.jupyter \
    && code-server --install-extension dbcode.dbcode

# Copy in settings
COPY settings.json /home/coder/.local/share/code-server/User/settings.json

# Expose code-server port
EXPOSE 8443

# Start code-server
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]