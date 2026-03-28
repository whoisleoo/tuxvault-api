import multer from 'multer'

const storage = multer.diskStorage({
    destination: '/data/vault',
    filename: (req, file, cb) => {
        cb(null, file.originalname)
    }
})

const upload = multer({
    storage,
    limits: {
        fileSize: 15 * 1024 * 1024 * 1024 // limite do size do arquivo 
    }
})