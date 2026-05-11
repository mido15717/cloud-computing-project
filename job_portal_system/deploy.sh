#!/bin/bash

echo "Starting deployment..."

echo "Starting minikube..."
minikube start --driver=docker
if [ $? -ne 0 ]; then
  echo "Failed to start minikube!"
  exit 1
fi
echo "Minikube started"

echo "Pointing Docker to minikube..."
eval $(minikube docker-env)
if [ $? -ne 0 ]; then
  echo "Failed to configure Docker!"
  exit 1
fi
echo "Docker configured"

echo "Building images..."

docker build -t user-management-service:latest "./User Management Service"
if [ $? -ne 0 ]; then echo "Failed to build user-management-service!"; exit 1; fi
echo "user-management-service built"

docker build -t job-service:latest "./Job Service"
if [ $? -ne 0 ]; then echo "Failed to build job-service!"; exit 1; fi
echo "job-service built"

docker build -t application-service:latest "./Application Service"
if [ $? -ne 0 ]; then echo "Failed to build application-service!"; exit 1; fi
echo "application-service built"

docker build -t notification-service:latest "./Notification Service"
if [ $? -ne 0 ]; then echo "Failed to build notification-service!"; exit 1; fi
echo "notification-service built"

docker build -t frontend:latest "./frontend"
if [ $? -ne 0 ]; then echo "Failed to build frontend!"; exit 1; fi
echo "frontend built"

echo "Applying Kubernetes files..."
kubectl apply -f K8s/
if [ $? -ne 0 ]; then
  echo "Failed to apply Kubernetes files!"
  exit 1
fi
echo "Kubernetes files applied"

echo "Waiting for pods to be ready..."
kubectl wait --for=condition=ready pod --all -n job-portal --timeout=300s
if [ $? -ne 0 ]; then
  echo "Some pods failed to start — check kubectl get pods -n job-portal"
  exit 1
fi
echo "Deployment complete!"
kubectl get pods -n job-portal
echo "Your app URL:"
minikube service frontend -n job-portal --url