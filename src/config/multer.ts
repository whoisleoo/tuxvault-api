import multer from 'multer'
import { randomBytes } from 'crypto'
import * as path from 'path'
import { env } from './env.js'

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, env.VAULT_PATH)
    },
    filename: (req, file, cb) => {
        const unique = `${Date.now()}-${randomBytes(6).toString('hex')}`
        const ext = path.extname(file.originalname)
        cb(null, `${unique}${ext}`)
    }
})

export const upload = multer({ storage, limits: { fileSize: env.UPLOAD_MAX_SIZE_GB * 1024 * 1024 * 1024 } })
