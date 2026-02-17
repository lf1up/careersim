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
    kustomization.yaml          # Base config: resources, configMapGenerator, secretGenerator
    namespace.yaml
    pvc-uploads.yaml
    backend-deployment.yaml
    backend-service.yaml
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
      ingress.yaml              # HTTP ingress for careersim.local
    prod/
      kustomization.yaml        # GHCR images, prod secrets, prod CORS origins
      ingress.yaml              # TLS ingress for api.careersim.ai (cert-manager)
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

The prod overlay uses GHCR container images (`ghcr.io/lf1up/careersim`), TLS ingress via cert-manager for `api.careersim.ai`, and separate secret values. Before applying, update secrets and image tags in `overlays/prod/kustomization.yaml`.

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

---

## License

This project is licensed under the MIT License -- see the [LICENSE.md](../../LICENSE.md) file for details.

## Author

Pavel Vdovenko ([reactivecake@gmail.com](mailto:reactivecake@gmail.com))
