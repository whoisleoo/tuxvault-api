import multer from 'multer'

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, '/data/vault');
    },
    filename: (req, file, cb) =>{
        cb(null, file.originalname)
    }
})

export const upload = multer({ storage: storage, limits: { fileSize: 15 * 1024 * 1024 * 1024}})
