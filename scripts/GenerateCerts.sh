#!/bin/bash

set -e

CERTS_DIR="./certs"
NODES=("node1" "node2" "node3" "node4" "node5" "node6")
DAYS_VALID=365

mkdir -p "$CERTS_DIR/ca"

openssl genrsa -out "$CERTS_DIR/ca/ca.key" 4096
openssl req -new -x509 -days $DAYS_VALID \
    -key "$CERTS_DIR/ca/ca.key" \
    -out "$CERTS_DIR/ca/ca.crt" \
    -subj "//CN=Raft CA"

for NODE in "${NODES[@]}"; do
    mkdir -p "$CERTS_DIR/$NODE"

    openssl genrsa -out "$CERTS_DIR/$NODE/$NODE.key" 4096

    openssl req -new \
        -key "$CERTS_DIR/$NODE/$NODE.key" \
        -out "$CERTS_DIR/$NODE/$NODE.csr" \
        -subj "//CN=$NODE"

    cat > "$CERTS_DIR/$NODE/$NODE.ext" <<EOF
subjectAltName=DNS:localhost,DNS:$NODE,IP:127.0.0.1
extendedKeyUsage=serverAuth,clientAuth
basicConstraints=CA:FALSE
EOF

    openssl x509 -req -days $DAYS_VALID \
        -in "$CERTS_DIR/$NODE/$NODE.csr" \
        -CA "$CERTS_DIR/ca/ca.crt" \
        -CAkey "$CERTS_DIR/ca/ca.key" \
        -CAcreateserial \
        -out "$CERTS_DIR/$NODE/$NODE.crt" \
        -extfile "$CERTS_DIR/$NODE/$NODE.ext"
    
    rm "$CERTS_DIR/$NODE/$NODE.csr"
    rm "$CERTS_DIR/$NODE/$NODE.ext"

done

echo "Done. Add certs/**/*.key to .gitignore"
