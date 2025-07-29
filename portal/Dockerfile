FROM node:22-bullseye-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (needed for build)
RUN npm ci

# Copy source code
COPY . .

# Install terraform, AWS CLI v2, and Session Manager plugin with architecture detection
RUN apt-get update && apt-get install -y wget unzip curl && rm -rf /var/lib/apt/lists/*
RUN ARCH=$(case "$(uname -m)" in x86_64) echo "amd64" ;; aarch64) echo "arm64" ;; *) echo "amd64" ;; esac) && \
    SSM_ARCH=$(case "$(uname -m)" in x86_64) echo "64bit" ;; aarch64) echo "arm64" ;; *) echo "64bit" ;; esac) && \
    AWS_ARCH=$(case "$(uname -m)" in x86_64) echo "x86_64" ;; aarch64) echo "aarch64" ;; *) echo "x86_64" ;; esac) && \
    # Install AWS CLI v2 \
    curl "https://awscli.amazonaws.com/awscli-exe-linux-${AWS_ARCH}.zip" -o "awscliv2.zip" \
    && unzip awscliv2.zip \
    && ./aws/install \
    && rm -rf aws awscliv2.zip \
    # Install Terraform \
    && wget https://releases.hashicorp.com/terraform/1.5.7/terraform_1.5.7_linux_${ARCH}.zip \
    && unzip terraform_1.5.7_linux_${ARCH}.zip \
    && mv terraform /usr/local/bin/ \
    && rm terraform_1.5.7_linux_${ARCH}.zip \
    # Install AWS Session Manager plugin \
    && curl "https://s3.amazonaws.com/session-manager-downloads/plugin/latest/ubuntu_${SSM_ARCH}/session-manager-plugin.deb" -o "session-manager-plugin.deb" \
    && dpkg -i session-manager-plugin.deb \
    && rm session-manager-plugin.deb

# Build the Next.js application
RUN npm run build

# Remove dev dependencies after build
RUN npm prune --production

# Expose port 3000
EXPOSE 3000

# Start the application or run init script based on environment
CMD ["npm", "start"]