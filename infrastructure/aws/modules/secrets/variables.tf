variable "project" { type = string }
variable "environment" { type = string }
variable "secrets" {
  type        = map(string)
  description = "Map of secret env var name -> value"
}
variable "tags" { type = map(string) }


