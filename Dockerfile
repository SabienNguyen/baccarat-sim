# ---- build the engine (wasm) and the table service ----
FROM rust:1 AS rust-build
RUN rustup target add wasm32-unknown-unknown \
 && curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY engine engine
COPY engine-wasm engine-wasm
COPY server server
RUN wasm-pack build engine-wasm --target bundler \
 && cargo build --release -p baccarat-server

# ---- build the site against the freshly built wasm pkg ----
FROM node:22-slim AS web-build
WORKDIR /src
COPY package.json package-lock.json ./
COPY web web
COPY smoke smoke
COPY --from=rust-build /src/engine-wasm/pkg engine-wasm/pkg
RUN npm ci && npm --workspace web run build

# ---- tiny runtime: one process serves the SPA and /ws ----
FROM debian:bookworm-slim
WORKDIR /app
COPY --from=rust-build /src/target/release/baccarat-server ./baccarat-server
COPY --from=web-build /src/web/dist ./dist
ENV SPA_DIR=/app/dist
ENV PORT=8080
EXPOSE 8080
CMD ["./baccarat-server"]
