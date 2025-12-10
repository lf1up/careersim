## K8S Infrastructure (Terraform) — Deployment Guide (self-hosted)

This directory provides a plain Kubernetes setup using Kustomize, mirroring the AWS Terraform layout:

- Namespace `careersim`
- Backend API `Deployment`/`Service`
- Postgres, Redis, and RAG `StatefulSet`/`Service`
- Transformers `Deployment`/`Service`
- Persistent volume claim for uploads
- Kustomize overlays for `dev` and `prod`

### Structure

```
infrastructure/k8s/
  base/
    app-config.yaml
    app-secrets.example.yaml
    backend-deployment.yaml
    backend-service.yaml
    namespace.yaml
    kustomization.yaml
    pvc-uploads.yaml
    postgres-statefulset.yaml
    postgres-service.yaml
    redis-statefulset.yaml
    redis-service.yaml
    rag-statefulset.yaml
    rag-service.yaml
    transformers-deployment.yaml
    transformers-service.yaml
  overlays/
    dev/
      kustomization.yaml
      ingress.yaml
    prod/
      kustomization.yaml
```

### Prereqs

- A Kubernetes cluster (e.g., kind, k3d, k3s, GKE, EKS, etc.)
- `kubectl` and `kustomize` (kubectl has `-k` built-in)
- Ingress controller (for dev overlay paths): NGINX ingress or similar
- Storage class available for PVCs

### Quick start (dev)

1. Apply dev overlay:
   ```bash
   kubectl apply -k infrastructure/k8s/overlays/dev
   ```
2. Add host entry to access via ingress:
   ```bash
   echo "127.0.0.1 careersim.local" | sudo tee -a /etc/hosts
   ```
3. Port-forward if not using ingress:
   ```bash
   kubectl -n careersim port-forward svc/dev-backend 8000:8000
   ```

### Production overlay

Before applying, set image names/tags and secrets in `overlays/prod/kustomization.yaml`.

```bash
kubectl apply -k infrastructure/k8s/overlays/prod
```

### Notes

- **LangGraph**: Enabled by default (`USE_LANGGRAPH=true`). This uses the embedded LangGraph conversation system for AI simulations.
  - Optional: Set `LANGCHAIN_TRACING_V2=true` to enable LangSmith tracing
  - Optional: Configure `LANGGRAPH_DEPLOYMENT_URL` and `LANGGRAPH_API_KEY` to use a remote LangGraph deployment
  - Optional: Set `LANGCHAIN_API_KEY` to enable LangSmith monitoring
- GPU scheduling for `transformers` uses a resource limit `nvidia.com/gpu: 1`. Ensure NVIDIA device plugin is installed on nodes if needed.
- Database creds are sourced from `Secret app-secrets`; update accordingly if using an external DB.
- The backend expects envs aligned with Terraform vars in `infrastructure/aws/main.tf`.


