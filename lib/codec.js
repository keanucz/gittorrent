import c from 'compact-encoding'

// Nullable string codec: 1-byte flag (0=null, 1=present) then string
const nullableString = {
  preencode (state, val) {
    c.uint8.preencode(state, val === null ? 0 : 1)
    if (val !== null) c.string.preencode(state, val)
  },
  encode (state, val) {
    if (val === null) {
      c.uint8.encode(state, 0)
    } else {
      c.uint8.encode(state, 1)
      c.string.encode(state, val)
    }
  },
  decode (state) {
    const flag = c.uint8.decode(state)
    if (flag === 0) return null
    return c.string.decode(state)
  }
}

// Fixed 40-byte codec for SHA strings
const sha40 = c.fixed(40)

// ref-update codec
export const refUpdateCodec = {
  preencode (state, val) {
    c.string.preencode(state, val.op)
    c.string.preencode(state, val.ref)
    nullableString.preencode(state, val.oldSha)
    sha40.preencode(state, Buffer.from(val.newSha, 'ascii'))
    c.bool.preencode(state, val.force)
    c.fixed64.preencode(state, val.signature)
    c.uint32.preencode(state, val.timestamp)
  },
  encode (state, val) {
    c.string.encode(state, val.op)
    c.string.encode(state, val.ref)
    nullableString.encode(state, val.oldSha)
    sha40.encode(state, Buffer.from(val.newSha, 'ascii'))
    c.bool.encode(state, val.force)
    c.fixed64.encode(state, val.signature)
    c.uint32.encode(state, val.timestamp)
  },
  decode (state) {
    return {
      op: c.string.decode(state),
      ref: c.string.decode(state),
      oldSha: nullableString.decode(state),
      newSha: sha40.decode(state).toString('ascii'),
      force: c.bool.decode(state),
      signature: c.fixed64.decode(state),
      timestamp: c.uint32.decode(state)
    }
  }
}

// add-writer codec
export const addWriterCodec = {
  preencode (state, val) {
    c.string.preencode(state, val.op)
    c.fixed32.preencode(state, val.key)
    c.bool.preencode(state, val.indexer)
    c.fixed64.preencode(state, val.signature)
  },
  encode (state, val) {
    c.string.encode(state, val.op)
    c.fixed32.encode(state, val.key)
    c.bool.encode(state, val.indexer)
    c.fixed64.encode(state, val.signature)
  },
  decode (state) {
    return {
      op: c.string.decode(state),
      key: c.fixed32.decode(state),
      indexer: c.bool.decode(state),
      signature: c.fixed64.decode(state)
    }
  }
}

// remove-writer codec
export const removeWriterCodec = {
  preencode (state, val) {
    c.string.preencode(state, val.op)
    c.fixed32.preencode(state, val.key)
    c.fixed64.preencode(state, val.signature)
  },
  encode (state, val) {
    c.string.encode(state, val.op)
    c.fixed32.encode(state, val.key)
    c.fixed64.encode(state, val.signature)
  },
  decode (state) {
    return {
      op: c.string.decode(state),
      key: c.fixed32.decode(state),
      signature: c.fixed64.decode(state)
    }
  }
}

// objects-available codec
export const objectsAvailableCodec = {
  preencode (state, val) {
    c.string.preencode(state, val.op)
    c.uint32.preencode(state, val.shas.length)
    for (const sha of val.shas) {
      sha40.preencode(state, Buffer.from(sha, 'ascii'))
    }
  },
  encode (state, val) {
    c.string.encode(state, val.op)
    c.uint32.encode(state, val.shas.length)
    for (const sha of val.shas) {
      sha40.encode(state, Buffer.from(sha, 'ascii'))
    }
  },
  decode (state) {
    const op = c.string.decode(state)
    const len = c.uint32.decode(state)
    const shas = []
    for (let i = 0; i < len; i++) {
      shas.push(sha40.decode(state).toString('ascii'))
    }
    return { op, shas }
  }
}

// secrets-key-envelope codec
export const secretsKeyEnvelopeCodec = {
  preencode (state, val) {
    c.string.preencode(state, val.op)
    c.fixed32.preencode(state, val.recipientKey)
    c.buffer.preencode(state, val.encryptedKey)
    c.uint32.preencode(state, val.keyVersion)
    c.fixed64.preencode(state, val.signature)
  },
  encode (state, val) {
    c.string.encode(state, val.op)
    c.fixed32.encode(state, val.recipientKey)
    c.buffer.encode(state, val.encryptedKey)
    c.uint32.encode(state, val.keyVersion)
    c.fixed64.encode(state, val.signature)
  },
  decode (state) {
    return {
      op: c.string.decode(state),
      recipientKey: c.fixed32.decode(state),
      encryptedKey: c.buffer.decode(state),
      keyVersion: c.uint32.decode(state),
      signature: c.fixed64.decode(state)
    }
  }
}

// secrets-key-rotate codec
export const secretsKeyRotateCodec = {
  preencode (state, val) {
    c.string.preencode(state, val.op)
    c.uint32.preencode(state, val.newKeyVersion)
    c.fixed64.preencode(state, val.signature)
  },
  encode (state, val) {
    c.string.encode(state, val.op)
    c.uint32.encode(state, val.newKeyVersion)
    c.fixed64.encode(state, val.signature)
  },
  decode (state) {
    return {
      op: c.string.decode(state),
      newKeyVersion: c.uint32.decode(state),
      signature: c.fixed64.decode(state)
    }
  }
}

// Op type tag mapping
const OP_TYPES = [
  'ref-update',
  'add-writer',
  'remove-writer',
  'objects-available',
  'secrets-key-envelope',
  'secrets-key-rotate'
]

const OP_CODECS = [
  refUpdateCodec,
  addWriterCodec,
  removeWriterCodec,
  objectsAvailableCodec,
  secretsKeyEnvelopeCodec,
  secretsKeyRotateCodec
]

// opCodec — discriminated union with a leading uint8 type tag
// The per-type codecs encode the 'op' string field; we skip re-encoding it
// by dispatching after writing the tag and delegating to codecs that include op.
// Simpler: just encode a uint8 tag then delegate to the full per-type codec
// (which encodes the op string). On decode, read tag, decode via codec (op
// string is already included in decoded object).
export const opCodec = {
  preencode (state, val) {
    const idx = OP_TYPES.indexOf(val.op)
    c.uint8.preencode(state, idx)
    OP_CODECS[idx].preencode(state, val)
  },
  encode (state, val) {
    const idx = OP_TYPES.indexOf(val.op)
    c.uint8.encode(state, idx)
    OP_CODECS[idx].encode(state, val)
  },
  decode (state) {
    const idx = c.uint8.decode(state)
    return OP_CODECS[idx].decode(state)
  }
}
