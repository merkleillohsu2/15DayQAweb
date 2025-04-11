const express = require('express');
const multer = require('multer');
const { importSurveyRewards } = require('../controllers/surveyRewardsController');

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

router.get('/', (req, res) => {
  res.render('UploadSurveyReward'); // 確保這裡的 'UploadSurveyReward' 與 ejs 文件名一致
});

router.post('/upload-survey-rewards', upload.single('csvFile'), importSurveyRewards);

module.exports = router;