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
    image: xogroup/planning-tools:10
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
                withCredentials([file(credentialsId:'tkww-npmrc', variable:'NPMRC_LOCATION')]) {
                    container('node') {
                        sh "cp $NPMRC_LOCATION ~/.npmrc"
                        sh "npm install && npm run build && npm publish"
                    }
                }
            }
        }
    }
}