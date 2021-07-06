pipeline {
    agent {
        kubernetes {
            label "typewriter"
            yaml  """
kind: Pod
metadata:
  name: typewriter
spec:
  containers:
  - name: node
    image: xogroup/registry-nodebox:0.1
    imagePullPolicy: Always
    tty: true
"""
        }
    }
    stages {
        stage('Publish Package') {
            when { 
              branch 'master'
            }
            steps {
                withCredentials([file(credentialsId:'ci-npmrc', variable:'NPMRC_LOCATION')]) {
                    container('node') {
                        sh "cp $NPMRC_LOCATION ~/.npmrc"
                        sh "yarn install && yarn run build && cp package.json dist/ && npm publish"
                    }
                }
            }
        }
    }
}