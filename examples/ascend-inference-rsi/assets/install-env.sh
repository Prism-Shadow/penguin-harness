#!/usr/bin/env bash
# Reproduce the inference stack for examples/ascend-inference-rsi.
# Target: Ubuntu 22.04 x86_64, Ascend 950PR, CANN 9.2.1 preinstalled.
set -euo pipefail

CONDA_PREFIX=/opt/miniconda3
ENV_NAME=ascend
PY="$CONDA_PREFIX/envs/$ENV_NAME/bin/python"
PIP="$CONDA_PREFIX/envs/$ENV_NAME/bin/pip"
MIRROR=https://repo.huaweicloud.com/repository/pypi/simple
TRITON_INDEX=https://triton-ascend.osinfra.cn/pypi/simple/
SRC_DIR=/opt

source /usr/local/Ascend/cann/set_env.sh

# 1. Python 3.11
if [ ! -x "$CONDA_PREFIX/bin/conda" ]; then
  curl -fsSL -o /tmp/miniconda.sh https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh
  bash /tmp/miniconda.sh -b -p "$CONDA_PREFIX"
fi
"$CONDA_PREFIX/bin/conda" tos accept --override-channels --channel https://repo.anaconda.com/pkgs/main >/dev/null 2>&1 || true
"$CONDA_PREFIX/bin/conda" tos accept --override-channels --channel https://repo.anaconda.com/pkgs/r >/dev/null 2>&1 || true
[ -d "$CONDA_PREFIX/envs/$ENV_NAME" ] || "$CONDA_PREFIX/bin/conda" create -y -q -n "$ENV_NAME" python=3.11

# 2. torch 2.10.0+cpu and torch_npu 2.10.0.post7
# torch_npu requires exactly the +cpu local version of torch.
"$PIP" install --no-cache-dir torch==2.10.0 --index-url https://download.pytorch.org/whl/cpu
"$PIP" install --no-cache-dir torchvision==0.25.0 --index-url https://download.pytorch.org/whl/cpu
"$PIP" install --no-cache-dir torch-npu==2.10.0.post7 -i "$MIRROR"

# 3. vLLM 0.30.0, built without CUDA kernels
if [ ! -d "$SRC_DIR/vllm" ]; then
  git clone --depth 1 --branch v0.30.0 https://github.com/vllm-project/vllm.git "$SRC_DIR/vllm"
fi
cd "$SRC_DIR/vllm"
VLLM_TARGET_DEVICE=empty "$PIP" install --no-cache-dir -e . -i "$MIRROR"

# 4. vLLM-Ascend 0.30.0
if [ ! -d "$SRC_DIR/vllm-ascend" ]; then
  git clone --depth 1 --branch releases/v0.30.0 --recurse-submodules \
    https://github.com/vllm-project/vllm-ascend.git "$SRC_DIR/vllm-ascend"
fi
cd "$SRC_DIR/vllm-ascend"
# vLLM-Ascend pins fastapi<0.124, vLLM needs >=0.133; keep vLLM's version and skip the pin.
grep -v '^fastapi' requirements.txt > /tmp/vllm-ascend-requirements.txt
"$PIP" install --no-cache-dir -r /tmp/vllm-ascend-requirements.txt -i "$MIRROR" \
  --extra-index-url "$TRITON_INDEX" --trusted-host triton-ascend.osinfra.cn
COMPILE_CUSTOM_KERNELS=1 MAX_JOBS=32 "$PIP" install --no-build-isolation --no-deps --no-cache-dir -e .

# 5. Validate
"$PY" -c "import acl; print('soc:', acl.get_soc_name())"
"$PY" -c "import torch, torch_npu; print('torch:', torch.__version__, 'torch_npu:', torch_npu.__version__, 'npu:', torch.npu.is_available())"
"$PY" -c "import vllm, vllm_ascend; print('vllm:', vllm.__version__, 'vllm_ascend:', vllm_ascend.__version__)"
