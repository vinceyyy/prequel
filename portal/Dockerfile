FROM node:22-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (needed for build)
RUN npm ci

# Copy source code
COPY . .

# Install terraform and AWS CLI with architecture detection
RUN apk add --no-cache wget unzip aws-cli
RUN ARCH=$(case "$(uname -m)" in x86_64) echo "amd64" ;; aarch64) echo "arm64" ;; *) echo "amd64" ;; esac) && \
    wget https://releases.hashicorp.com/terraform/1.5.7/terraform_1.5.7_linux_${ARCH}.zip \
    && unzip terraform_1.5.7_linux_${ARCH}.zip \
    && mv terraform /usr/local/bin/ \
    && rm terraform_1.5.7_linux_${ARCH}.zip

# Build the Next.js application
RUN npm run build

# Remove dev dependencies after build
RUN npm prune --production

# Expose port 3000
EXPOSE 3000

# Start the application or run init script based on environment
CMD ["npm", "start"]