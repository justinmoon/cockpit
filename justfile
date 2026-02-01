# Build and run
run *args:
    npm run build
    node dist/cli.js {{args}}

# Install globally via npm link
install:
    npm run build
    npm link
