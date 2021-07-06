pipeline {
    stages {
        stage('npm Install') {
            steps {
                withCredentials([file(credentialsId:'ci-npmrc', variable:'NPMRC_LOCATION')]) {
                    container('build') { 
                        sh "cp $NPMRC_LOCATION ~/.npmrc"
                        sh "npm install"
                    }
                }
            }
        }
        stage('Publish Package') {
            when { 
              branch 'master'
            }
            steps {
                withCredentials([file(credentialsId:'ci-npmrc', variable:'NPMRC_LOCATION')]) {
                    container('build') {
                        sh "cp $NPMRC_LOCATION ~/.npmrc"
                        sh "npm install && npm run build && npm publish"
                    }
                }
            }
        }
    }
}