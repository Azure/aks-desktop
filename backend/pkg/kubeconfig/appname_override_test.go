package kubeconfig_test

import (
	"testing"

	"github.com/kubernetes-sigs/headlamp/backend/pkg/kubeconfig"
	"github.com/stretchr/testify/assert"
)

func TestApplyAppNameOverride(t *testing.T) {
	tests := []struct {
		name     string
		envValue string
		envSet   bool
		want     string
	}{
		{
			name:     "env unset keeps default",
			envValue: "",
			envSet:   false,
			want:     "Headlamp",
		},
		{
			name:     "env empty string keeps default",
			envValue: "",
			envSet:   true,
			want:     "Headlamp",
		},
		{
			name:     "env set overrides",
			envValue: "aks-desktop",
			envSet:   true,
			want:     "aks-desktop",
		},
		{
			name:     "env with whitespace is preserved verbatim",
			envValue: "My App",
			envSet:   true,
			want:     "My App",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			getenv := func(key string) string {
				if key != "HEADLAMP_APP_NAME" {
					t.Fatalf("unexpected env key requested: %q", key)
				}
				if !tt.envSet {
					return ""
				}
				return tt.envValue
			}

			got := kubeconfig.ApplyAppNameOverride(getenv)
			assert.Equal(t, tt.want, got)
		})
	}
}
